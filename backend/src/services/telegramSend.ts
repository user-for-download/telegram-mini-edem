// backend/src/services/telegramSend.ts
//
// Клиент Telegram Bot API sendMessage (ADR approved 2026-09-14).
//
// Транспорт: прямой fetch ИЛИ SOCKS5-прокси (TELEGRAM_API_PROXY,
// например socks5://192.168.12.75:1080 — среда разработки ходит в
// api.telegram.org только так). Нативный fetch SOCKS не умеет, поэтому
// при настроенном прокси используется node:https + SocksProxyAgent.
//
// Исходы (SendOutcome) — машина, без текстов ответа Telegram:
// - ok            → 200, сообщение доставлено;
// - bot_blocked   → 403: пользователь заблокировал бота (перманентно);
// - rate_limited  → 429: глобальный лимит Telegram, уважаем retry_after;
// - permanent     → 400 и прочие 4xx: повтор бессмыслен;
// - transient     → сеть/таймаут/5xx: кандидат на ретрай диспетчера.
//
// Приватность: в лог не попадает text/chatId/token — только исход.
// Транспорт инжектится (deps.post) для юнит-тестов без сети.
import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";
import { env } from "../env.js";
import { logger } from "../logger.js";

export type SendOutcome =
  | { ok: true }
  | { ok: false; kind: "bot_blocked" }
  | { ok: false; kind: "rate_limited"; retryAfterMs: number }
  | { ok: false; kind: "permanent" }
  | { ok: false; kind: "transient" };

export interface SendInput {
  /** Telegram chat id (для личных чатов = telegramUserId). */
  chatId: number;
  /** Текст: title + "\n\n" + body inbox-уведомления (§6а.4). */
  text: string;
  /** Allowlist deep-link для кнопки «Открыть» (web_app). */
  deepLink?: string;
}

/** JSON-тело sendMessage: превью ссылок выключено (тексты без URL). */
export function buildSendMessageBody(input: SendInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    disable_web_page_preview: true,
  };
  // Кнопка «Открыть» — только при настроенном Mini App URL (ADR:
  // deep-link allowlist уже применён вызывающим кодом).
  if (input.deepLink && env.TELEGRAM_WEBAPP_URL) {
    body.reply_markup = {
      inline_keyboard: [
        [
          {
            text: "Открыть",
            web_app: { url: `${env.TELEGRAM_WEBAPP_URL}${input.deepLink}` },
          },
        ],
      ],
    };
  }
  return body;
}

/** URL webhook-стиля: секретный токен в path, в логи никогда не попадает. */
export function sendMessageUrl(): string {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
}

export interface TelegramSendDeps {
  /** POST-транспорт: (url, bodyJson) → {status, body}. Инжект в тестах. */
  post?: (url: string, body: unknown) => Promise<{ status: number; body: unknown }>;
}

/** POST через fetch или SOCKS5-прокси (https.request + agent). */
async function httpPost(
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  if (env.TELEGRAM_API_PROXY) {
    return proxyPost(url, body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, body: await safeJson(res) };
  } finally {
    clearTimeout(timer);
  }
}

/** Транспорт через SOCKS5: SocksProxyAgent + node:https. */
async function proxyPost(
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const agent = new SocksProxyAgent(env.TELEGRAM_API_PROXY);
    const req = https.request(
      url,
      { method: "POST", agent, headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Маппинг HTTP-исхода на SendOutcome (чистая, тестируется отдельно). */
export function mapStatusToOutcome(
  status: number,
  body: unknown,
): SendOutcome {
  if (status === 200) return { ok: true };
  if (status === 403) return { ok: false, kind: "bot_blocked" };
  if (status === 429) {
    const retrySec = Number(
      (body as { parameters?: { retry_after?: number } })?.parameters
        ?.retry_after ?? 30,
    );
    return {
      ok: false,
      kind: "rate_limited",
      retryAfterMs: Math.min(Math.max(retrySec, 1), 3600) * 1000,
    };
  }
  if (status >= 400 && status < 500) return { ok: false, kind: "permanent" };
  return { ok: false, kind: "transient" };
}

/**
 * Отправка сообщения боту. Никогда не бросает: любой сбой — transient.
 */
export async function sendTelegramMessage(
  input: SendInput,
  deps: TelegramSendDeps = {},
): Promise<SendOutcome> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    // Токена нет — канал выключен; диспетчер обязан звать только при
    // непустом токене, это страховочная ветка.
    return { ok: false, kind: "permanent" };
  }
  const post = deps.post ?? httpPost;
  try {
    const { status, body } = await post(sendMessageUrl(), buildSendMessageBody(input));
    const outcome = mapStatusToOutcome(status, body);
    if (!outcome.ok && outcome.kind !== "rate_limited") {
      logger.debug(
        { status, kind: outcome.kind, chatId: input.chatId },
        "tg_send_outcome",
      );
    }
    return outcome;
  } catch (error) {
    logger.debug({ err: error, chatId: input.chatId }, "tg_send_transport_error");
    return { ok: false, kind: "transient" };
  }
}
