import {
  adminPaginatedAuditLogSchema,
  type AdminAuditAction,
  type AdminAuditTargetType,
  type AdminPaginatedAuditLog,
} from "@edem/contracts";

import { apiGet } from "@/lib/api-client";

export interface FetchAuditParams {
  action?: AdminAuditAction;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  page: number;
  pageSize: number;
}

export function buildAuditSearchParams(
  params: FetchAuditParams,
): URLSearchParams {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.action) search.set("action", params.action);
  if (params.targetType) search.set("targetType", params.targetType);
  const targetId = params.targetId?.trim();
  if (targetId) search.set("targetId", targetId);
  return search;
}

/** GET /api/v1/admin/audit — append-only журнал админ-мутаций. */
export function fetchAuditLogs(
  params: FetchAuditParams,
): Promise<AdminPaginatedAuditLog> {
  return apiGet(
    `/audit?${buildAuditSearchParams(params).toString()}`,
    adminPaginatedAuditLogSchema,
  );
}
