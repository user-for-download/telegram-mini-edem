// backend/src/services/clientErrorReporter.ts
//
// Приём клиентских ошибок (POST /api/v1/client-errors): санитайзинг,
// отпечаток, троттлинг алертов в Telegram, глобальный потолок.
// Сами ошибки всегда пишутся в pino; алерты — fire-and-forget.
//
// Часы и транспорт инжектятся (deps) для юнит-тестов без сети —
// как уже сделано в telegramSend.
import { createHash } from "node:crypto";
import { logger } from "../logger.js";
import { sendTelegramMessage, type SendInput } from "./telegramSend.js";

export const CLIENT_ERROR_DEDUPE_TTL_MS = 30 * 60 * 1000;
export const CLIENT_ERROR_MAX_ENTRIES = 200;
export const CLIENT_ERROR_MAX_ALERTS_PER_HOUR = 20;
export const CLIENT_ERROR_ALERT_MAX_LENGTH = 1000;

const REDACTED = "[redacted]";

/**
 * Санитайзинг: данные приходят из браузера, им нельзя доверять.
 * Вырезаем из message/stack/route/componentStack всё похожее
 * на секреты: query-строки, tgWebAppData, hash=, JWT, длинные hex.
 */
export function sanitizeClientErrorText(value: string): string {
  return value
    .replace(/tgWebAppData=[^\s&]*/g, `tgWebAppData=${REDACTED}`)
    .replace(/\bhash=[^\s&]*/g, `hash=${REDACTED}`)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/\b[0-9a-fA-F]{32,}\b/g, "[hex]")
    .replace(/\?[\w%.~-]+=[^\s]*/g, `?${REDACTED}`);
}

export function sanitizeClientError(input: ErrorReportInput): ErrorReportInput {
  return {
    ...input,
    message: sanitizeClientErrorText(input.message),
    stack: input.stack ? sanitizeClientErrorText(input.stack) : undefined,
    componentStack: input.componentStack
      ? sanitizeClientErrorText(input.componentStack)
      : undefined,
    route: input.route ? sanitizeClientErrorText(input.route) : undefined,
  };
}

/**
 * Вход репортёра. ClientError из контрактов совместим структурно;
 * внутренний вид kind="server" публичной схемой не принимается.
 */
export interface ErrorReportInput {
  kind: string;
  message: string;
  stack?: string;
  componentStack?: string;
  route?: string;
  release?: string;
}

/**
 * Строка похожа на кадр стека: V8 "at ..." или Safari/Firefox
 * "fn@file:line" (e-mail вида user@host без :line не подходит).
 */
export function isStackFrameLine(line: string): boolean {
  return /^\s*at\s/i.test(line) || /@\S*:\d+/.test(line);
}

/**
 * Нормализация маршрута для отпечатка: UUID и числовые сегменты
 * (ID поездок в hash-маршрутах) заменяются на :id — иначе одна и та же
 * ошибка с разных ID даёт разные отпечатки и съедает часовой бюджет.
 * В тексте алерта маршрут остаётся как есть.
 */
export function normalizeRouteForFingerprint(route: string): string {
  return route
    .replace(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
      ":id",
    )
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

/**
 * Отпечаток: kind + message + первый кадр стека (без номеров строк
 * и колонок) + нормализованный route. Первая строка V8-стека —
 * заголовок ошибки, а не кадр, поэтому пропускаем её через
 * isStackFrameLine; иначе — первая непустая строка.
 */
export function fingerprintClientError(
  kind: string,
  message: string,
  stack?: string,
  route?: string,
): string {
  const lines = (stack ?? "")
    .split("\n")
    .map((line: string) => line.replace(/:\d+(?::\d+)?/g, "").trim())
    .filter((line: string) => line.length > 0);
  const firstFrame =
    lines.find((line) => isStackFrameLine(line)) ?? lines[0] ?? "";
  return createHash("sha1")
    .update(
      `${kind}\n${message}\n${firstFrame}\n${normalizeRouteForFingerprint(route ?? "")}`,
    )
    .digest("hex");
}

/** Текст алерта: plain text без parse_mode, IP не включаем. */
export function buildClientErrorAlertText(
  input: ErrorReportInput,
  repeats: number,
): string {
  const title =
    input.kind === "server" ? "server-error" : `client-error [${input.kind}]`;
  const lines = [title];
  if (repeats > 0) lines.push(`повторов с прошлого алерта: ×${repeats}`);
  if (input.route) lines.push(`route: ${input.route}`);
  if (input.release) lines.push(`release: ${input.release}`);
  lines.push(input.message);
  const firstFrames = (input.stack ?? "")
    .split("\n")
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0)
    .slice(0, 3);
  if (firstFrames.length > 0) lines.push(firstFrames.join("\n"));
  const text = lines.join("\n");
  return text.length > CLIENT_ERROR_ALERT_MAX_LENGTH
    ? `${text.slice(0, CLIENT_ERROR_ALERT_MAX_LENGTH - 1)}…`
    : text;
}

export interface ClientErrorReporterOptions {
  /** Пусто = алерты выключены, работает только лог. */
  chatId?: number;
  enabled?: boolean;
  now?: () => number;
  send?: (input: SendInput) => Promise<unknown>;
  dedupeTtlMs?: number;
  maxEntries?: number;
  maxAlertsPerHour?: number;
}

interface SeenEntry {
  lastAlertAt: number;
  repeats: number;
}

export interface ClientErrorReporter {
  report(input: ErrorReportInput): void;
}

/**
 * Фабрика репортёра с in-memory состоянием (один инстанс — один Map).
 * Никогда не бросает: отправка fire-and-forget, сбои — только в лог.
 */
export function createClientErrorReporter(
  options: ClientErrorReporterOptions = {},
): ClientErrorReporter {
  const {
    chatId,
    enabled = true,
    now = () => Date.now(),
    send = (input) => sendTelegramMessage(input),
    dedupeTtlMs = CLIENT_ERROR_DEDUPE_TTL_MS,
    maxEntries = CLIENT_ERROR_MAX_ENTRIES,
    maxAlertsPerHour = CLIENT_ERROR_MAX_ALERTS_PER_HOUR,
  } = options;

  const seen = new Map<string, SeenEntry>();
  let windowStart = now();
  let alertsSent = 0;
  let suppressed = 0;

  function rollWindowIfElapsed(current: number): void {
    if (current - windowStart < 3_600_000) return;
    const missed = suppressed;
    windowStart = current;
    alertsSent = 0;
    suppressed = 0;
    if (missed > 0 && chatId !== undefined) {
      const target = chatId;
      void Promise.resolve()
        .then(() =>
          send({ chatId: target, text: `client-errors: пропущено алертов за час: ${missed}` }),
        )
        .then(
          () => undefined,
          (error: unknown) => {
            logger.debug({ err: error }, "client_error_summary_failed");
          },
        );
    }
  }

  function sendAlert(text: string): void {
    if (chatId === undefined) return;
    const target = chatId;
    void Promise.resolve()
      .then(() => send({ chatId: target, text }))
      .then(
        (outcome) => {
          if (
            outcome &&
            typeof outcome === "object" &&
            "ok" in outcome &&
            !(outcome as { ok: boolean }).ok
          ) {
            // Фатальные исходы (токен/чат мёртв) — в warn, иначе сбой
            // диагностики будет слепым: запись client_error есть, а причины
            // недоставки на debug-уровне не видно. Транзиентные (сеть,
            // rate limit) остаются на debug, чтобы не шуметь.
            const kind = (outcome as { kind?: unknown }).kind;
            if (kind === "permanent" || kind === "bot_blocked") {
              logger.warn({ outcome }, "client_error_alert_not_delivered");
            } else {
              logger.debug({ outcome }, "client_error_alert_not_delivered");
            }
          }
        },
        (error: unknown) => {
          logger.debug({ err: error }, "client_error_alert_failed");
        },
      );
  }

  return {
    report(input: ErrorReportInput): void {
      const clean = sanitizeClientError(input);
      const current = now();
      logger.warn(
        {
          kind: clean.kind,
          route: clean.route,
          release: clean.release,
          message: clean.message,
          stack: clean.stack ? clean.stack.slice(0, 2000) : undefined,
        },
        "client_error",
      );
      if (!enabled || chatId === undefined) return;

      rollWindowIfElapsed(current);

      const fingerprint = fingerprintClientError(
        clean.kind,
        clean.message,
        clean.stack,
        clean.route,
      );
      const entry = seen.get(fingerprint);
      if (entry && current - entry.lastAlertAt < dedupeTtlMs) {
        entry.repeats += 1;
        return;
      }

      if (alertsSent >= maxAlertsPerHour) {
        suppressed += 1;
        return;
      }

      alertsSent += 1;
      sendAlert(buildClientErrorAlertText(clean, entry?.repeats ?? 0));
      seen.delete(fingerprint);
      if (seen.size >= maxEntries) {
        const oldest = seen.keys().next();
        if (!oldest.done) seen.delete(oldest.value);
      }
      seen.set(fingerprint, { lastAlertAt: current, repeats: 0 });
    },
  };
}
