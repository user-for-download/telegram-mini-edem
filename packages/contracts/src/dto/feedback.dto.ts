import { z } from "zod";

// ─── CreateFeedbackDto ──────────────────────────────────────────────────────
/**
 * Обращение в поддержку из мини-аппа (Профиль → Помощь и поддержка).
 * Лимиты синхронизированы с UI: тема до 100 символов, текст до 2000.
 */
export const FEEDBACK_SUBJECT_MAX_LENGTH = 100;
export const FEEDBACK_TEXT_MAX_LENGTH = 2000;
// RAW initData Telegram (query-params строка) для TG-апелляции забаненного:
// тот же cap 4096, что у telegramAuthRequestSchema (реальная initData ~1-2 КБ).
export const FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH = 4096;

export const createFeedbackDtoSchema = z.object({
  // .trim() — проверка (check) в zod 4: выполняется до min/max, поэтому
  // строки только из пробелов отклоняются, а лимиты применяются к обрезанному
  // значению (backend сохраняет trimmed-значения).
  subject: z.string().trim().min(1).max(FEEDBACK_SUBJECT_MAX_LENGTH),
  text: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX_LENGTH),
});

export type CreateFeedbackDto = z.infer<typeof createFeedbackDtoSchema>;

// ─── FeedbackTelegramAppealDto ────────────────────────────────────────────
/**
 * TG-апелляция забаненного пользователя (публичный эндпоинт, без токена).
 * Личность подтверждается подписью Telegram initData (verifyTelegramInitData,
 * та же что в /auth/telegram).
 *
 * Безопасность (backend POST /feedback/appeal):
 * - используется ТОЛЬКО проверенный telegramUserId из подписи; display-поля
 *   внутри initData (имя/аватар) на идентификацию не влияют и игнорируются;
 * - токены не выдаются; бан не проверяется (апелляция — канал забаненного),
 *   tombstone удалённых отклоняется 403.
 */
export const feedbackTelegramAppealDtoSchema = z.object({
  initData: z
    .string()
    .trim()
    .min(1)
    .max(FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH),
  subject: z.string().trim().min(1).max(FEEDBACK_SUBJECT_MAX_LENGTH),
  text: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX_LENGTH),
});

export type FeedbackTelegramAppealDto = z.infer<
  typeof feedbackTelegramAppealDtoSchema
>;

// ─── FeedbackAppealRequest (Telegram-only) ──────────────────────────────────
/**
 * Тело POST /feedback/appeal: только TG-вариант (initData).
 */
export const feedbackAppealRequestSchema = feedbackTelegramAppealDtoSchema;

export type FeedbackAppealRequest = z.infer<typeof feedbackAppealRequestSchema>;

// ─── CreateFeedbackResponse ─────────────────────────────────────────────────
export const createFeedbackResponseSchema = z
  .object({
    id: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type CreateFeedbackResponse = z.infer<typeof createFeedbackResponseSchema>;

// ─── AdminFeedbackReplyBody ─────────────────────────────────────────────────
/**
 * Тело POST/PUT /admin/feedback/:id/reply. Текст ответа (≤ 2000, тот же лимит
 * что и у самого обращения). Trim до min-length — пробельные строки отвергаются.
 */
export const feedbackReplyBodySchema = z
  .object({
    reply: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX_LENGTH),
  })
  .strict();

export type FeedbackReplyBody = z.infer<typeof feedbackReplyBodySchema>;

// ─── UserFeedbackDto ────────────────────────────────────────────────────────
/**
 * DTO одного обращения в поддержку для пользователя (мини-апп, раздел
 * «Помощь и поддержка» → «Мои обращения»). Содержит сам текст обращения
 * и, если есть, ответ админа. `reply === null` — ещё не отвечено.
 */
export const userFeedbackDtoSchema = z
  .object({
    id: z.string(),
    subject: z.string(),
    text: z.string(),
    reply: z.string().nullable(),
    repliedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type UserFeedbackDto = z.infer<typeof userFeedbackDtoSchema>;
