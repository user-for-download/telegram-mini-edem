import { z } from "zod";
import { reportCategorySchema, reportStatusSchema, reportTargetTypeSchema } from "../schemas/report.schema.js";

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
