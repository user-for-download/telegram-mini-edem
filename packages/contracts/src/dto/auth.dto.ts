import { z } from "zod";
import { userSchema } from "../schemas/user.schema.js";

// ─── Auth ───────────────────────────────────────────────────────────────────
// (Только Telegram-вариант ниже.)

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: userSchema,
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});

export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

// ─── Telegram ───────────────────────────────────────────────────────────────
/**
 * Telegram Mini Apps auth: клиент присылает RAW initData (query-params
 * строка) РОВНО как её отдал Telegram — ключи/порядок не пересортированы,
 * иначе серверная валидация HMAC не сойдётся. Подпись Telegram покрывает
 * ВСЮ строку (user/auth_date/hash), отдельные поля в контракт не входят —
 * реконструкция по частям невозможна.
 * Длина: реальная initData ~1-2 КБ; cap 4096 с запасом.
 */
export const telegramAuthRequestSchema = z.object({
  initData: z.string().min(1).max(4096),
});

export type TelegramAuthRequest = z.infer<typeof telegramAuthRequestSchema>;

// ─── Banned Error (403) ────────────────────────────────────────────────────
/**
 * Тело 403-ответа при попытке действия забаненным пользователем.
 * `code` намеренно строковый литерал `"FORBIDDEN"` — точное совпадение
 * со `backend/src/errors.ts::ERROR_CODES.FORBIDDEN`. Не используем enum,
 * чтобы контракт не зависел от серверной реализации.
 * `banReason` — null для старых банов без причины (см. ТЗ: «Причина не указана»).
 */
export const bannedErrorSchema = z
  .object({
    code: z.literal("FORBIDDEN"),
    message: z.string(),
    banReason: z.string().nullable(),
  })
  .strict();

export type BannedError = z.infer<typeof bannedErrorSchema>;
