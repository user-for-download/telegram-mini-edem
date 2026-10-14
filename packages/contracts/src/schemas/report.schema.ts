import { z } from "zod";

export const REPORT_CATEGORIES = [
  "safety",
  "fraud",
  "harassment",
  "spam",
  "inaccurate_info",
  "other",
] as const;

export const REPORT_TARGET_TYPES = ["user", "trip", "booking"] as const;
export const REPORT_STATUSES = ["pending", "in_review", "resolved", "rejected"] as const;

export const reportCategorySchema = z.enum(REPORT_CATEGORIES);
export const reportTargetTypeSchema = z.enum(REPORT_TARGET_TYPES);
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;

export const reportSchema = z.object({
  id: z.string().uuid(),
  targetType: reportTargetTypeSchema,
  targetId: z.string().min(1),
  category: reportCategorySchema,
  description: z.string().min(1).max(2000),
  status: reportStatusSchema,
  resolutionNote: z.string().max(2000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export type Report = z.infer<typeof reportSchema>;

/**
 * Объект, на который пользователь ВПРАВЕ пожаловаться — кандидат для выбора в
 * форме (GET /reports/targets). Список собирает бэкенд ровно по тем правилам,
 * что проверяет `canReport` при создании жалобы, поэтому «выбрал из списка» и
 * «сервер принял» совпадают, а клиенту не нужно знать UUID объекта.
 *
 * Поля — СЫРЫЕ (маршрут, момент отправления, имя), а не готовые строки: дату
 * клиент форматирует сам по Москве (`moscowNumericDate`), как везде в
 * приложении. Готовая подпись бэка была бы в его зоне и на другом языке.
 */
export const reportTargetSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("trip"),
    /** id поездки — уходит в createReport.targetId. */
    id: z.string().min(1),
    fromCity: z.string().min(1),
    toCity: z.string().min(1),
    departureAt: z.string().datetime(),
  }),
  z.object({
    targetType: z.literal("booking"),
    /** id брони — уходит в createReport.targetId. */
    id: z.string().min(1),
    fromCity: z.string().min(1),
    toCity: z.string().min(1),
    departureAt: z.string().datetime(),
  }),
  z.object({
    targetType: z.literal("user"),
    /** id пользователя — уходит в createReport.targetId. */
    id: z.string().min(1),
    name: z.string().min(1),
  }),
]);

export const reportTargetsSchema = z.array(reportTargetSchema);
export type ReportTarget = z.infer<typeof reportTargetSchema>;
export type ReportTargets = z.infer<typeof reportTargetsSchema>;
