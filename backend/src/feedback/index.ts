// backend/src/feedback/index.ts
import { Hono } from "hono";
import {
  createFeedbackDtoSchema,
  feedbackAppealRequestSchema,
} from "@edem/contracts";
import type { UserFeedbackDto } from "@edem/contracts";
import { db } from "../db.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import { verifyTelegramInitData } from "../auth/telegramSign.js";
import { logger } from "../logger.js";
import { createRateLimiter, mutationLimiter, feedbackReadLimiter } from "../middleware/rateLimit.js";
import { devRateMax } from "../env.js";
import { getSanitizedBody } from "../middleware/sanitize.js";
import { ERROR_CODES } from "../errors.js";
import { logBusinessEvent } from "../logger/business.js";

export const feedbackRouter = new Hono<AuthEnv>();

// Апелляция забаненного пользователя: токена у него нет (логин отклоняется
// 403), поэтому эндпоинт публичный с жёстким лимитом по IP (5 раз в час).
const appealLimiter = createRateLimiter({
  windowMs: 3600000,
  max: devRateMax(5),
  keyPrefix: "feedback-appeal",
});

/**
 * POST /api/v1/feedback — обращение пользователя в поддержку.
 *
 * Поля уже ограничены контрактом (subject ≤ 100, text ≤ 2000) и
 * санитизированы DOMPurify в getSanitizedBody.
 */
feedbackRouter.post("/", requireUser, mutationLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parseResult = createFeedbackDtoSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid feedback payload",
        issues: parseResult.error.issues,
      },
      400,
    );
  }

  const user = c.get("user");
  const { subject, text } = parseResult.data;

  const feedback = await db.feedback.create({
    data: {
      userId: user.id,
      subject: subject.trim(),
      text: text.trim(),
    },
  });

  logBusinessEvent("feedback.created", {
    feedbackId: feedback.id,
    userId: user.id,
  });
  logger.info({ feedbackId: feedback.id, userId: user.id }, "feedback created");

  return c.json(
    { id: feedback.id, createdAt: feedback.createdAt.toISOString() },
    201,
  );
});

/**
 * POST /api/v1/feedback/appeal — обращение забаненного пользователя (публичный).
 *
 * У забаненного нет токена (логин отклоняется 403), поэтому личность
 * подтверждается подписью Telegram initData (verifyTelegramInitData —
 * та же проверка, что в /auth/telegram: HMAC/TTL, dev-bypass только
 * вне production без токена бота), токены не выдаются.
 *
 * Без доверия к display-полям: из подписанных данных используется ТОЛЬКО
 * проверенный telegramUserId для поиска userId; имя/аватар из initData
 * на идентификацию не влияют.
 *
 * Проверки бана нет: апелляция — канал связи именно забаненного пользователя.
 * Tombstone удалённых отклоняется 403: удаление терминально, апелляция его
 * не resurrect'ит.
 */
feedbackRouter.post("/appeal", appealLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parseResult = feedbackAppealRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid feedback payload",
        issues: parseResult.error.issues,
      },
      400,
    );
  }

  const { subject, text } = parseResult.data;
  const payload = parseResult.data;

  // Идентификация ТОЛЬКО по проверенной подписи Telegram initData.
  // Display-поля (имя/аватар из initData) игнорируются.
  const { isValid, telegramUserId } = verifyTelegramInitData(payload.initData);
  if (!isValid || telegramUserId === undefined) {
    return c.json({ message: "Invalid or expired signature" }, 401);
  }
  const user = await db.user.findUnique({ where: { telegramUserId } });
  if (!user) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "User not found" },
      404,
    );
  }
  // Tombstone удалённых терминален: апелляция удалённого не resurrect'ит.
  if (user.deletedAt) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Account is deleted" },
      403,
    );
  }
  const userId = user.id;

  // Проверки бана нет: апелляция — канал связи именно забаненного пользователя.
  const feedback = await db.feedback.create({
    data: { userId, subject: subject.trim(), text: text.trim() },
  });

  logBusinessEvent("feedback-appeal.created", {
    feedbackId: feedback.id,
    userId,
  });
  logger.info(
    { feedbackId: feedback.id, userId },
    "feedback appeal created",
  );

  return c.json(
    { id: feedback.id, createdAt: feedback.createdAt.toISOString() },
    201,
  );
});

/**
 * GET /api/v1/feedback — список СВОИХ обращений в поддержку (новые первыми).
 * Содержит исходный текст и, если есть, ответ админа. Нужен мини-аппу для
 * раздела «Помощь и поддержка» → «Мои обращения».
 */
feedbackRouter.get("/", requireUser, feedbackReadLimiter, async (c) => {
  const user = c.get("user");
  const items = await db.feedback.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const payload: UserFeedbackDto[] = items.map((f) => ({
    id: f.id,
    subject: f.subject,
    text: f.text,
    reply: f.reply,
    repliedAt: f.repliedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  }));
  return c.json(payload);
});
