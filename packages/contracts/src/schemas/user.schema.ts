import { z } from "zod";

// ─── Car ────────────────────────────────────────────────────────────────────
export const carSchema = z.object({
  model: z.string().min(1).max(50),
  color: z.string().min(1).max(30),
  // Public trip/user serializers omit the plate to avoid exposing vehicle identifiers.
  plate: z.string().max(15).optional(),
});

export type Car = z.infer<typeof carSchema>;

// ─── User ───────────────────────────────────────────────────────────────────
export const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  avatar: z.string().url(),
  rating: z.number().min(0).max(5),
  reviewsCount: z.number().int().min(0),
  tripsCount: z.number().int().min(0),
  isVerified: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  verifiedAt: z.string().datetime().nullable().optional(),
  onboardingVersion: z.string().nullable().optional(),
  car: carSchema.optional(),
  about: z.string().max(500).optional(),
  // Телефон (F1): сервер отдаёт только владельцу и подтверждённой
  // стороне в деталях поездки; отсутствие = скрыт/не указан.
  phone: z.string().max(25).optional(),
  createdAt: z.string().datetime().optional(),
});

export type User = z.infer<typeof userSchema>;

// ─── Onboarding ─────────────────────────────────────────────────────────────
/**
 * Тело завершения онбординга (POST /users/me/onboarding):
 * версия показанных слайдов. При смене набора слайдов клиент
 * повышает версию и повторно показывает онбординг.
 */
export const completeOnboardingBodySchema = z
  .object({
    version: z.string().trim().min(1).max(50),
  })
  .strict();

export type CompleteOnboardingBody = z.infer<typeof completeOnboardingBodySchema>;

// ─── Role ───────────────────────────────────────────────────────────────────
export const roleSchema = z.enum(["passenger", "driver"]);

export type Role = z.infer<typeof roleSchema>;
