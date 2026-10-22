import { z } from "zod";
import {
  ADMIN_FILTER_ID_MAX_LENGTH,
  ADMIN_PAGE_SIZE_MAX,
} from "./admin.schema.js";

// ─── Constants ──────────────────────────────────────────────────────────────
/**
 * Every admin mutation that must leave a trace. The list is intentionally
 * closed: adding a new admin mutation means adding it here as well, otherwise
 * the audit filter and the read model cannot represent it.
 */
export const ADMIN_AUDIT_ACTIONS = [
  "user.ban",
  "user.unban",
  "user.onboarding_reset",
  "user.telegram_stop",
  "trip.cancel",
  "booking.status",
  "review.approve",
  "review.reject",
  "review.delete",
  "feedback.reply",
  "report.status",
  "city.create",
  "city.update",
  "city.delete",
  "city.recompute",
] as const;

export const ADMIN_AUDIT_TARGET_TYPES = [
  "user",
  "trip",
  "booking",
  "review",
  "feedback",
  "report",
  "city",
  "system",
] as const;

export const ADMIN_AUDIT_ACTOR_TYPES = ["admin", "system"] as const;

export const adminAuditActionSchema = z.enum(ADMIN_AUDIT_ACTIONS);
export const adminAuditTargetTypeSchema = z.enum(ADMIN_AUDIT_TARGET_TYPES);
export const adminAuditActorTypeSchema = z.enum(ADMIN_AUDIT_ACTOR_TYPES);

export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;
export type AdminAuditTargetType = z.infer<typeof adminAuditTargetTypeSchema>;
export type AdminAuditActorType = z.infer<typeof adminAuditActorTypeSchema>;

// ─── Query ──────────────────────────────────────────────────────────────────
/** Sanity ceiling for the page index (offset pagination). */
const ADMIN_AUDIT_PAGE_MAX = 10_000;

/**
 * Read-only audit filters. All fields are optional; `pageSize` reuses the
 * admin cap so every admin list accepts the same upper bound.
 */
export const adminAuditQuerySchema = z
  .object({
    action: adminAuditActionSchema.optional(),
    targetType: adminAuditTargetTypeSchema.optional(),
    targetId: z
      .string()
      .trim()
      .min(1)
      .max(ADMIN_FILTER_ID_MAX_LENGTH)
      .optional(),
    page: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_AUDIT_PAGE_MAX)
      .default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_PAGE_SIZE_MAX)
      .default(20),
  })
  .strict();

export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

// ─── DTO ────────────────────────────────────────────────────────────────────
/**
 * One immutable audit record. `metadata` is a free-form JSON snapshot of the
 * mutation (previous/new status, reason, counts) and must never contain PII
 * beyond what the admin already sees behind `adminGuard`.
 */
export const adminAuditLogDtoSchema = z
  .object({
    id: z.string(),
    action: adminAuditActionSchema,
    targetType: adminAuditTargetTypeSchema,
    targetId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    actorType: adminAuditActorTypeSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type AdminAuditLog = z.infer<typeof adminAuditLogDtoSchema>;
