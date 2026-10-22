import type { Prisma } from "../generated/prisma/client.js";
import type {
  AdminReportDto,
  AdminReportTargetSummaryDto,
  ReportTargetType,
} from "@edem/contracts";

export type ReportWithRelations = Prisma.ReportGetPayload<{
  include: { reporter: true; adminActor: true };
}>;

/**
 * Fallback-подпись объекта жалобы. Показывается, когда сам объект удалён или
 * ещё не резолвится (targetSummary === null), поэтому строка обязательна.
 */
const TARGET_LABELS: Record<ReportTargetType, string> = {
  user: "Пользователь",
  trip: "Поездка",
  booking: "Бронь",
};

export function serializeReport(report: ReportWithRelations) {
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    category: report.category,
    description: report.description,
    status: report.status,
    resolutionNote: report.resolutionNote,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Админ-жалоба с человекочитаемым контекстом цели.
 *
 * `targetSummary` резолвится батчем в `reports/index.ts` (по одному запросу
 * на тип цели), а не внутри сериализатора — иначе список из 20 жалоб сделал
 * бы до 20 дополнительных запросов. `null` означает «объект не найден»:
 * `targetLabel` при этом всё равно заполнен, чтобы UI не показывал пустоту.
 */
export function serializeAdminReport(
  report: ReportWithRelations,
  targetSummary: AdminReportTargetSummaryDto | null = null,
): AdminReportDto {
  const targetType = report.targetType as ReportTargetType;
  return {
    ...serializeReport(report),
    // В БД status/category/targetType хранятся строками (schema.prisma);
    // контракт ждёт enum-значения. Значения пишутся только валидные.
    targetType,
    category: report.category as AdminReportDto["category"],
    status: report.status as AdminReportDto["status"],
    reporterId: report.reporterId,
    reporterName: report.reporter.name,
    adminActorId: report.adminActorId,
    adminActorType: report.adminActorType,
    adminActorName: report.adminActor?.name ?? null,
    targetLabel: TARGET_LABELS[targetType] ?? "Объект",
    targetSummary,
  };
}
