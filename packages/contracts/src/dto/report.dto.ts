import { z } from "zod";
import {
  reportCategorySchema,
  reportSchema,
  reportStatusSchema,
  reportTargetTypeSchema,
} from "../schemas/report.schema.js";

export const REPORT_DESCRIPTION_MAX_LENGTH = 2000;

export const createReportDtoSchema = z.object({
  targetType: reportTargetTypeSchema,
  // IDs are opaque strings; legacy seeded records use values such as `t-1`.
  targetId: z.string().trim().min(1).max(100),
  category: reportCategorySchema,
  description: z.string().trim().min(1).max(REPORT_DESCRIPTION_MAX_LENGTH),
}).strict();
export type CreateReportDto = z.infer<typeof createReportDtoSchema>;

export const adminReportsQuerySchema = z.object({
  status: reportStatusSchema.optional(),
  targetType: reportTargetTypeSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type AdminReportsQuery = z.infer<typeof adminReportsQuerySchema>;

export const updateReportStatusDtoSchema = z.object({
  // Допустимые переходы выводятся из единственного источника REPORT_STATUSES
  // (исключаем только начальный "pending"): новое значение в справочнике не
  // пройдёт мимо, а опечатка не скомпилируется (см. rideRequestStatusUpdateSchema).
  status: reportStatusSchema.extract(["in_review", "resolved", "rejected"]),
  resolutionNote: z.string().trim().max(REPORT_DESCRIPTION_MAX_LENGTH).optional(),
}).strict();
export type UpdateReportStatusDto = z.infer<typeof updateReportStatusDtoSchema>;

// ─── Admin ──────────────────────────────────────────────────────────────────
/**
 * Human-readable context for the reported entity. Admin lists show the same
 * label regardless of target type, so the backend resolves the raw relation
 * once and the client does not need a second request per report row.
 *
 * `userId` / `tripId` / `bookingId` are navigation hints: only the identifier
 * relevant to `targetType` is expected to be non-null, the rest stay null.
 */
export const adminReportTargetSummaryDtoSchema = z
  .object({
    id: z.string(),
    targetType: reportTargetTypeSchema,
    /** e.g. user name, "Москва → Тула", "Бронь: место 2". */
    label: z.string(),
    /** Short supporting line: trip status/date or booking status. */
    secondary: z.string().nullable(),
    userId: z.string().nullable(),
    tripId: z.string().nullable(),
    bookingId: z.string().nullable(),
  })
  .strict();

export type AdminReportTargetSummaryDto = z.infer<
  typeof adminReportTargetSummaryDtoSchema
>;

export const adminReportDtoSchema = reportSchema
  .extend({
    reporterId: z.string(),
    reporterName: z.string(),
    adminActorId: z.string().nullable(),
    adminActorType: z.string().nullable(),
    adminActorName: z.string().nullable(),
    /** Always-present fallback ("Пользователь", "Поездка", "Бронь"). */
    targetLabel: z.string(),
    /** Null when the target was deleted or cannot be resolved. */
    targetSummary: adminReportTargetSummaryDtoSchema.nullable(),
  })
  .strict();

export type AdminReportDto = z.infer<typeof adminReportDtoSchema>;

export const adminPaginatedReportsSchema = z
  .object({
    items: z.array(adminReportDtoSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export type AdminPaginatedReports = z.infer<
  typeof adminPaginatedReportsSchema
>;
