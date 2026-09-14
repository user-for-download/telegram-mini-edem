// backend/src/bot/index.ts
//
// Webhook Telegram-бота (bot-api-approval-package §4.2): единственная
// точка входа апдейтов бота. Секрет в path (POST /bot/webhook/:secret)
// сравнивается timing-safe; без него Telegram-апдейты не принимаются.
//
// Поддерживаемые команды:
// - /start  → фиксация согласия: User.tgChatJoinedAt = now (если
//   telegramUserId совпадает с отправителем). Бот не может написать
//   первым, поэтому это и есть акт подписки.
// - /stop   → сброс согласия: tgChatJoinedAt = null. Немедленный стоп:
//   политика читается в момент отправки, не кэшируется.
//
// Shadow mode: отправка ответных сообщений НЕ выполняется (Bot API
// заблокирован ADR telegram-notification-delivery) — вебхук только
// размечает согласие. Все ответы 200 OK, чтобы Telegram не ретраил.
//
// Приватность: в логах только command + userId, без текста апдейта.
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { tokensEqual } from "../utils/timingSafeEqual.js";

export const botRouter = new Hono();

/** Валидация апдейта message (Bot API): нужен только отправитель и команда. */
const botUpdateSchema = z.object({
  message: z
    .object({
      from: z.object({ id: z.number().int() }).passthrough(),
      chat: z.object({ id: z.number().int() }).passthrough(),
      text: z.string().max(512).optional(),
    })
    .optional(),
  edited_message: z
    .object({
      from: z.object({ id: z.number().int() }).passthrough(),
      text: z.string().max(512).optional(),
    })
    .optional(),
  // Неизвестные поля (callback_query и пр.) игнорируются passthrough-режимом
  // схемы выше; сам объект ограничен bodyLimit 100KB на уровне app.
});

/** Достаёт команду из текста сообщения: "/start" или "/start@botname args". */
function parseBotCommand(text?: string): string | null {
  if (!text || !text.startsWith("/")) return null;
  const token = text.slice(1).split(/\s+/)[0] ?? "";
  // /start@my_bot → "start" (режим групповых чатов; у нас личные, но
  // синтаксис валиден везде).
  const command = token.split("@")[0] ?? "";
  return command || null;
}

botRouter.post("/webhook/:secret", async (c) => {
  const provided = c.req.param("secret");
  if (!provided || !tokensEqual(provided, env.TELEGRAM_WEBHOOK_SECRET)) {
    // 404 вместо 401: не раскрываем существование endpoint-брутфорсу.
    logger.warn({ path: "/bot/webhook" }, "bot_webhook_bad_secret");
    return c.notFound();
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    // Мусорный body: отвечаем 200, чтобы Telegram не ретраил бесконечно.
    return c.json({ ok: true });
  }

  const parsed = botUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ ok: true });
  }

  const message = parsed.data.message ?? parsed.data.edited_message;
  const command = message ? parseBotCommand(message.text) : null;

  if (command !== "start" && command !== "stop") {
    // Чужие команды/сообщения игнорируем молча (200 = без ретраев).
    return c.json({ ok: true });
  }

  const telegramId = message?.from.id;
  if (telegramId === undefined) {
    return c.json({ ok: true });
  }

  try {
    if (command === "start") {
      // updateMany: не раскрываем наличие аккаунта ответом; консент
      // ставится только реальному пользователю мини-аппа.
      const result = await db.user.updateMany({
        where: { telegramUserId: BigInt(telegramId), deletedAt: null },
        data: { tgChatJoinedAt: new Date() },
      });
      if (result.count > 0) {
        logger.info({ command, userId: telegramId }, "bot_consent_granted");
      }
    } else {
      const result = await db.user.updateMany({
        where: { telegramUserId: BigInt(telegramId) },
        data: { tgChatJoinedAt: null },
      });
      if (result.count > 0) {
        logger.info({ command, userId: telegramId }, "bot_consent_revoked");
      }
    }
  } catch (error) {
    // Ошибка БД: 500 — Telegram ретраит апдейт позже (это желаемое
    // поведение для фиксации согласия).
    logger.error({ err: error, command }, "bot_webhook_db_error");
    return c.json({ ok: false }, 500);
  }

  return c.json({ ok: true });
});
