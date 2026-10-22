import { apiDelete, apiGet, apiPatch } from "@/lib/api-client";
import {
  adminPaginatedReviewsSchema,
  adminReviewDetailDtoSchema,
  adminReviewDtoSchema,
  type AdminPaginatedReviews,
  type AdminReviewDetailDto,
  type AdminReviewDto,
  type ReviewStatusValue,
} from "@edem/contracts";
import { z } from "zod";

const deleteReviewResponseSchema = z.object({ ok: z.boolean(), id: z.string() }).strict();

export interface FetchReviewsParams {
  status?: ReviewStatusValue;
  q?: string;
  authorId?: string;
  targetUserId?: string;
  page: number;
  pageSize: number;
}

/**
 * GET /api/v1/admin/reviews?status=&q=&authorId=&targetUserId=&page=&pageSize=
 * Все фильтры необязательные; пустые значения в query не попадают.
 */
export function buildReviewsSearchParams(
  params: FetchReviewsParams,
): URLSearchParams {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) search.set("status", params.status);
  const setIfPresent = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) search.set(key, trimmed);
  };
  setIfPresent("q", params.q);
  setIfPresent("authorId", params.authorId);
  setIfPresent("targetUserId", params.targetUserId);
  return search;
}

export function fetchReviews(
  params: FetchReviewsParams
): Promise<AdminPaginatedReviews> {
  return apiGet(
    `/reviews?${buildReviewsSearchParams(params).toString()}`,
    adminPaginatedReviewsSchema,
  );
}

/** GET /api/v1/admin/reviews/:id — полный текст и сводки участников. */
export function fetchReviewDetail(id: string): Promise<AdminReviewDetailDto> {
  return apiGet(
    `/reviews/${encodeURIComponent(id)}`,
    adminReviewDetailDtoSchema,
  );
}

/**
 * DELETE /api/v1/admin/reviews/:id — безвозвратное удаление отзыва.
 */
export function deleteReview(id: string): Promise<{ ok: boolean; id: string }> {
  return apiDelete(`/reviews/${encodeURIComponent(id)}`, deleteReviewResponseSchema);
}

/**
 * PATCH /api/v1/admin/reviews/:id/approve — одобрение (pending → published).
 * Отзыв становится публичным и начинает учитываться в рейтинге.
 * 409 CONFLICT, если отзыв уже не в статусе pending.
 */
export function approveReview(id: string): Promise<AdminReviewDto> {
  return apiPatch(`/reviews/${encodeURIComponent(id)}/approve`, undefined, adminReviewDtoSchema);
}

/**
 * PATCH /api/v1/admin/reviews/:id/reject — отклонение (pending → rejected).
 * Отзыв скрывается из публичного списка, рейтинг не меняется.
 * 409 CONFLICT, если отзыв уже не в статусе pending.
 */
export function rejectReview(id: string): Promise<AdminReviewDto> {
  return apiPatch(`/reviews/${encodeURIComponent(id)}/reject`, undefined, adminReviewDtoSchema);
}
