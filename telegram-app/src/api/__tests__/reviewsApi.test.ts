import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  apiClient: { request: vi.fn() },
  ApiError: class ApiError extends Error {
    code?: string;
    status?: number;
    constructor(message: string, code?: string, status?: number) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  },
}));

import { apiClient, ApiError } from "@/api/client";
import { reviewsApi } from "@/api/reviews.api";
import {
  paginatedReviewsResponseSchema,
  reviewSchema,
} from "@edem/contracts";

const requestMock = vi.mocked(apiClient.request);

const author = {
  id: "u-author",
  name: "Автор",
  avatar: "https://t.me/i/userpic/320/a.svg",
  rating: 5,
  reviewsCount: 1,
  tripsCount: 2,
};

const review = {
  id: "r-1",
  author,
  targetRole: "driver",
  rating: 5,
  text: "Отличная поездка!",
  status: "published",
  date: "1 сентября 2026",
  tripRoute: "Вологда → Череповец",
};

describe("reviewsApi (Telegram)", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("getUserReviews без cursor идёт на /reviews/user/:id с limit и сигналом", async () => {
    const signal = new AbortController().signal;
    requestMock.mockResolvedValue({
      items: [review],
      pagination: { nextCursor: null, hasMore: false, limit: 20 },
    });

    await reviewsApi.getUserReviews("user-1", undefined, 20, signal);

    expect(requestMock).toHaveBeenCalledWith(
      "/reviews/user/user-1?limit=20",
      { signal },
      paginatedReviewsResponseSchema,
    );
  });

  it("getUserReviews кодирует id и cursor-пагинацию", async () => {
    requestMock.mockResolvedValue({
      items: [],
      pagination: { nextCursor: null, hasMore: false, limit: 10 },
    });

    await reviewsApi.getUserReviews("user/with space", "cursor-1", 10);

    expect(requestMock).toHaveBeenCalledWith(
      "/reviews/user/user%2Fwith%20space?limit=10&cursor=cursor-1",
      { signal: undefined },
      paginatedReviewsResponseSchema,
    );
  });

  it("createReview пассажир → водитель: POST /reviews с JSON-телом и reviewSchema", async () => {
    requestMock.mockResolvedValue(review);
    const payload = {
      tripId: "t-1",
      targetUserId: "u-driver",
      rating: 5,
      text: "Доехали отлично!",
    };

    await reviewsApi.createReview(payload);

    expect(requestMock).toHaveBeenCalledWith(
      "/reviews",
      { method: "POST", body: JSON.stringify(payload) },
      reviewSchema,
    );
  });

  it("createReview водитель → пассажир: то же endpoint, цель — пассажир", async () => {
    requestMock.mockResolvedValue({ ...review, targetRole: "passenger" });
    const payload = {
      tripId: "t-1",
      targetUserId: "u-passenger",
      rating: 4,
      text: "Пунктуальный пассажир",
    };

    const result = await reviewsApi.createReview(payload);

    expect(requestMock).toHaveBeenCalledWith(
      "/reviews",
      { method: "POST", body: JSON.stringify(payload) },
      reviewSchema,
    );
    expect(result.targetRole).toBe("passenger");
  });

  it("getMyReviews идёт на /reviews/my (все статусы для вкладки «Мои»)", async () => {
    const signal = new AbortController().signal;
    requestMock.mockResolvedValue([{ ...review, status: "pending" }]);

    await reviewsApi.getMyReviews(signal);

    expect(requestMock).toHaveBeenCalledWith(
      "/reviews/my",
      { signal },
      expect.anything(),
    );
  });

  it("getAvailableTrips идёт на /reviews/available-trips", async () => {
    const signal = new AbortController().signal;
    requestMock.mockResolvedValue([]);

    await reviewsApi.getAvailableTrips(signal);

    expect(requestMock).toHaveBeenCalledWith(
      "/reviews/available-trips",
      { signal },
      expect.anything(),
    );
  });

  it("duplicate: ALREADY_REVIEWED (409) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("You already reviewed this user for this trip", "ALREADY_REVIEWED", 409),
    );

    await expect(
      reviewsApi.createReview({
        tripId: "t-1",
        targetUserId: "u-driver",
        rating: 5,
        text: "Повтор",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_REVIEWED", status: 409 });
  });

  it("conflict: CONFLICT (409, retryable) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("Concurrent update conflict, please retry", "CONFLICT", 409),
    );

    await expect(
      reviewsApi.createReview({
        tripId: "t-1",
        targetUserId: "u-driver",
        rating: 5,
        text: "Гонка",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("публичный список возвращает пагинированные published-отзывы как есть", async () => {
    const page = {
      items: [review],
      pagination: { nextCursor: null, hasMore: false, limit: 20 },
    };
    requestMock.mockResolvedValue(page);

    const result = await reviewsApi.getUserReviews("user-1");

    expect(result).toEqual(page);
    expect(result.items).toHaveLength(1);
  });
});
