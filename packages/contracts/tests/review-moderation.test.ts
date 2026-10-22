import { describe, it, expect } from "vitest";
import {
  createReviewDtoSchema,
  REVIEW_TEXT_MAX_LENGTH,
} from "../src/dto/review.dto";
import { paginatedReviewsResponseSchema } from "../src/schemas/review.schema";
import { REVIEW_STATUS, REVIEW_STATUSES } from "../src/schemas/status.const";
import {
  adminReviewDtoSchema,
  adminPaginatedReviewsSchema,
} from "../src/dto/admin.dto";
import { adminReviewsQuerySchema } from "../src/schemas/admin.schema";

describe("REVIEW_TEXT_MAX_LENGTH", () => {
  it("should equal 150", () => {
    expect(REVIEW_TEXT_MAX_LENGTH).toBe(150);
  });
});

describe("REVIEW_STATUS / REVIEW_STATUSES", () => {
  it("should carry exactly pending/published/rejected", () => {
    expect(REVIEW_STATUS).toEqual({
      PENDING: "pending",
      PUBLISHED: "published",
      REJECTED: "rejected",
    });
    expect(REVIEW_STATUSES).toEqual(["pending", "published", "rejected"]);
  });
});

describe("createReviewDtoSchema — 150-char limit", () => {
  const baseDto = {
    tripId: "t-1",
    targetUserId: "u-2",
    rating: 5,
  };

  it("should accept text of exactly 150 chars (boundary)", () => {
    const result = createReviewDtoSchema.safeParse({
      ...baseDto,
      text: "x".repeat(REVIEW_TEXT_MAX_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it("should reject text of 151 chars", () => {
    const result = createReviewDtoSchema.safeParse({
      ...baseDto,
      text: "x".repeat(REVIEW_TEXT_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("should apply the limit to the trimmed value (padding does not count)", () => {
    const result = createReviewDtoSchema.safeParse({
      ...baseDto,
      text: `  ${"x".repeat(REVIEW_TEXT_MAX_LENGTH)}  `,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe("x".repeat(REVIEW_TEXT_MAX_LENGTH));
    }
  });

  it("should reject text whose trimmed length exceeds the limit", () => {
    const result = createReviewDtoSchema.safeParse({
      ...baseDto,
      text: `  ${"x".repeat(REVIEW_TEXT_MAX_LENGTH + 1)}  `,
    });
    expect(result.success).toBe(false);
  });
});

describe("paginatedReviewsResponseSchema — status", () => {
  const baseReview = {
    id: "review-1",
    targetRole: "driver",
    rating: 5,
    text: "Отличная поездка",
    status: "pending",
    date: "1 января 2026 г.",
    tripRoute: "Москва → Тула",
    author: {
      id: "user-1",
      name: "Автор",
      avatar: "https://example.com/avatar.jpg",
      rating: 5,
      reviewsCount: 1,
      tripsCount: 1,
    },
  };

  const basePagination = {
    nextCursor: null,
    hasMore: false,
    limit: 20,
  };

  it("should accept a page where every item has a valid status", () => {
    const result = paginatedReviewsResponseSchema.safeParse({
      items: [
        baseReview,
        { ...baseReview, id: "review-2", status: "rejected" },
      ],
      pagination: basePagination,
    });
    expect(result.success).toBe(true);
  });

  it("should reject a page with an item whose status is invalid (fail-closed)", () => {
    const result = paginatedReviewsResponseSchema.safeParse({
      items: [{ ...baseReview, status: "approved" }],
      pagination: basePagination,
    });
    expect(result.success).toBe(false);
  });

  it("should reject a page with an item missing status (fail-closed)", () => {
    const { status: _status, ...rest } = baseReview;
    const result = paginatedReviewsResponseSchema.safeParse({
      items: [rest],
      pagination: basePagination,
    });
    expect(result.success).toBe(false);
  });
});

describe("adminReviewDtoSchema — status", () => {
  const baseAdminReview = {
    id: "r-1",
    rating: 5,
    text: "Отличная поездка",
    targetRole: "driver",
    status: "pending",
    tripRoute: "Москва → Тула",
    createdAt: "2026-09-01T12:00:00.000Z",
    authorId: "u-1",
    authorName: "Автор",
    targetUserId: "u-2",
    targetUserName: "Водитель",
  };

  it("should parse a valid admin review dto", () => {
    const result = adminReviewDtoSchema.safeParse(baseAdminReview);
    expect(result.success).toBe(true);
  });

  it("should accept status 'pending'", () => {
    const result = adminReviewDtoSchema.safeParse({
      ...baseAdminReview,
      status: "pending",
    });
    expect(result.success).toBe(true);
  });

  it("should accept status 'published'", () => {
    const result = adminReviewDtoSchema.safeParse({
      ...baseAdminReview,
      status: "published",
    });
    expect(result.success).toBe(true);
  });

  it("should accept status 'rejected'", () => {
    const result = adminReviewDtoSchema.safeParse({
      ...baseAdminReview,
      status: "rejected",
    });
    expect(result.success).toBe(true);
  });

  it("should reject a missing status", () => {
    const { status: _status, ...rest } = baseAdminReview;
    const result = adminReviewDtoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("should reject an invalid status", () => {
    const result = adminReviewDtoSchema.safeParse({
      ...baseAdminReview,
      status: "approved",
    });
    expect(result.success).toBe(false);
  });

  it("should reject unknown fields (strict)", () => {
    const result = adminReviewDtoSchema.safeParse({
      ...baseAdminReview,
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("adminPaginatedReviewsSchema", () => {
  it("should parse a paginated review list with status", () => {
    const result = adminPaginatedReviewsSchema.safeParse({
      items: [
        {
          id: "r-1",
          rating: 5,
          text: "Отличная поездка",
          targetRole: "driver",
          status: "pending",
          tripRoute: "Москва → Тула",
          createdAt: "2026-09-01T12:00:00.000Z",
          authorId: "u-1",
          authorName: "Автор",
          targetUserId: "u-2",
          targetUserName: "Водитель",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(result.success).toBe(true);
  });
});

describe("adminReviewsQuerySchema — status filter", () => {
  it("should parse a query without status (defaults applied)", () => {
    const result = adminReviewsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBeUndefined();
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("should accept status 'pending'", () => {
    const result = adminReviewsQuerySchema.safeParse({ status: "pending" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("pending");
    }
  });

  it("should accept status 'published'", () => {
    const result = adminReviewsQuerySchema.safeParse({ status: "published" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("published");
    }
  });

  it("should accept status 'rejected'", () => {
    const result = adminReviewsQuerySchema.safeParse({ status: "rejected" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("rejected");
    }
  });

  it("should reject an invalid status", () => {
    const result = adminReviewsQuerySchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });

  it("should reject a status with wrong case (enums are case-sensitive)", () => {
    const result = adminReviewsQuerySchema.safeParse({ status: "Pending" });
    expect(result.success).toBe(false);
  });

  it("should reject unknown fields (strict)", () => {
    const result = adminReviewsQuerySchema.safeParse({
      status: "pending",
      unknownFilter: "foo",
    });
    expect(result.success).toBe(false);
  });
});
