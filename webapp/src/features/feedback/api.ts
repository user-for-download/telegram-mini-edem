import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import {
  adminFeedbackDtoSchema,
  adminPaginatedFeedbackSchema,
  type AdminFeedbackDto,
  type AdminPaginatedFeedback,
  type FeedbackReplyBody,
} from "@edem/contracts";

export interface FetchFeedbackParams {
  answered?: "true" | "false";
  q?: string;
  page: number;
  pageSize: number;
}

/**
 * GET /api/v1/admin/feedback?answered=&q=&page=&pageSize=
 * answered — string literal ("true"/"false"), как в adminFeedbackQuerySchema.
 */
export function buildFeedbackSearchParams(
  params: FetchFeedbackParams,
): URLSearchParams {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.answered) search.set("answered", params.answered);
  const q = params.q?.trim();
  if (q) search.set("q", q);
  return search;
}

export function fetchFeedback(
  params: FetchFeedbackParams
): Promise<AdminPaginatedFeedback> {
  return apiGet(
    `/feedback?${buildFeedbackSearchParams(params).toString()}`,
    adminPaginatedFeedbackSchema,
  );
}

/**
 * GET /api/v1/admin/feedback/:id — детальная карточка обращения.
 */
export function fetchFeedbackById(id: string): Promise<AdminFeedbackDto> {
  return apiGet(`/feedback/${encodeURIComponent(id)}`, adminFeedbackDtoSchema);
}

/**
 * POST /api/v1/admin/feedback/:id/reply — первичный ответ админа.
 */
export function createFeedbackReply(
  id: string,
  reply: string
): Promise<AdminFeedbackDto> {
  return apiPost(
    `/feedback/${encodeURIComponent(id)}/reply`,
    { reply } satisfies FeedbackReplyBody,
    adminFeedbackDtoSchema,
  );
}

/**
 * PUT /api/v1/admin/feedback/:id/reply — редактирование существующего ответа.
 */
export function updateFeedbackReply(
  id: string,
  reply: string
): Promise<AdminFeedbackDto> {
  return apiPut(
    `/feedback/${encodeURIComponent(id)}/reply`,
    { reply } satisfies FeedbackReplyBody,
    adminFeedbackDtoSchema,
  );
}
