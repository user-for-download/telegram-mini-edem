import { apiGet, apiPatch } from "@/lib/api-client";
import {
  adminPaginatedReportsSchema,
  adminReportDtoSchema,
  type AdminPaginatedReports,
  type AdminReportDto,
  type AdminReportsQuery,
  type UpdateReportStatusDto,
} from "@edem/contracts";

export type AdminReport = AdminReportDto;
export type AdminReportStatus = AdminReportDto["status"];
export type AdminReportsResponse = AdminPaginatedReports;

/**
 * Query-строка списка жалоб. Порядок фиксирован, пустые фильтры опускаются:
 * бэкенд трактует отсутствие параметра как «фильтр не задан»
 * (см. adminReportsQuerySchema). Вынесено в чистую функцию, чтобы покрыть
 * фильтры node-тестами без DOM.
 */
export function buildReportsSearchParams(
  params: AdminReportsQuery,
): URLSearchParams {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) search.set("status", params.status);
  if (params.targetType) search.set("targetType", params.targetType);
  return search;
}

/**
 * GET /api/v1/admin/reports?status=&targetType=&page=&pageSize=
 * Плоский admin-контракт `{ items, total, page, pageSize }` — без legacy
 * `pagination`-обёртки. Ответ валидируется fail-closed в api-client.
 */
export function fetchReports(
  params: AdminReportsQuery,
): Promise<AdminPaginatedReports> {
  return apiGet(
    `/reports?${buildReportsSearchParams(params).toString()}`,
    adminPaginatedReportsSchema,
  );
}

/** GET /api/v1/admin/reports/:id — детальная карточка жалобы. */
export function fetchReportDetail(id: string): Promise<AdminReportDto> {
  return apiGet(`/reports/${encodeURIComponent(id)}`, adminReportDtoSchema);
}

/** PATCH /api/v1/admin/reports/:id/status — смена статуса модерации. */
export function updateReportStatus(
  id: string,
  data: UpdateReportStatusDto,
): Promise<AdminReportDto> {
  return apiPatch(
    `/reports/${encodeURIComponent(id)}/status`,
    data,
    adminReportDtoSchema,
  );
}
