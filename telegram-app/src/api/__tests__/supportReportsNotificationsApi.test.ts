import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  apiClient: { request: vi.fn() },
  ApiError: class ApiError extends Error {
    code?: string;
    status?: number;
    retryAfterMs?: number;
    constructor(message: string, code?: string, status?: number, retryAfterMs?: number) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
      this.retryAfterMs = retryAfterMs;
    }
  },
}));

import { apiClient, ApiError } from "@/api/client";
import { notificationsApi } from "@/api/notifications";
import { supportApi } from "@/api/support";
import { reportsApi } from "@/api/reports";
import {
  createFeedbackResponseSchema,
  notificationSchema,
  notificationsPageSchema,
  reportSchema,
} from "@edem/contracts";

const requestMock = vi.mocked(apiClient.request);

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    userId: "u-1",
    type: "booking_status_changed",
    title: "Бронь подтверждена",
    body: "Водитель подтвердил вашу заявку",
    isRead: false,
    createdAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("notificationsApi (Telegram)", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("getMy без cursor идёт на /notifications/my с limit", async () => {
    const signal = new AbortController().signal;
    requestMock.mockResolvedValue({ items: [], nextCursor: null });

    await notificationsApi.getMy(undefined, 20, signal);

    expect(requestMock).toHaveBeenCalledWith(
      "/notifications/my?limit=20",
      { signal },
      notificationsPageSchema,
    );
  });

  it("getMy сериализует cursor-пагинацию", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-09-09T10:00:00.000Z", id: "n-9" }),
    ).toString("base64");
    requestMock.mockResolvedValue({ items: [], nextCursor: null });

    await notificationsApi.getMy(cursor, 20);

    expect(requestMock).toHaveBeenCalledWith(
      `/notifications/my?limit=20&cursor=${encodeURIComponent(cursor)}`,
      { signal: undefined },
      notificationsPageSchema,
    );
  });

  it("markRead кодирует id и идёт на PATCH /:id/read", async () => {
    requestMock.mockResolvedValue(notification({ isRead: true }));

    const result = await notificationsApi.markRead("id/with space");

    expect(requestMock).toHaveBeenCalledWith(
      "/notifications/id%2Fwith%20space/read",
      { method: "PATCH" },
      notificationSchema,
    );
    expect(result.isRead).toBe(true);
  });

  it("markAllRead идёт на PATCH /read-all", async () => {
    requestMock.mockResolvedValue({ success: true });

    await notificationsApi.markAllRead();

    expect(requestMock).toHaveBeenCalledWith(
      "/notifications/read-all",
      { method: "PATCH" },
      expect.anything(),
    );
  });

  it("битый cursor (400 Invalid cursor) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("Invalid cursor", undefined, 400),
    );

    await expect(notificationsApi.getMy("!!!not-base64!!!")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("unauthorized (401) пробрасывается вызывающему без ретрая на уровне api", async () => {
    requestMock.mockRejectedValue(new ApiError("Unauthorized", undefined, 401));

    await expect(notificationsApi.getMy()).rejects.toMatchObject({ status: 401 });
    await expect(notificationsApi.markAllRead()).rejects.toMatchObject({ status: 401 });
  });
});

describe("supportApi (Telegram, без appeal)", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("create: POST /feedback с JSON-телом и схемой ответа", async () => {
    requestMock.mockResolvedValue({ id: "f-1", createdAt: "2026-09-09T10:00:00.000Z" });
    const payload = { subject: "Нет уведомления", text: "Не пришло подтверждение" };

    await supportApi.create(payload);

    expect(requestMock).toHaveBeenCalledWith(
      "/feedback",
      { method: "POST", body: JSON.stringify(payload) },
      createFeedbackResponseSchema,
    );
  });

  it("listMine идёт на GET /feedback с сигналом", async () => {
    const signal = new AbortController().signal;
    requestMock.mockResolvedValue([]);

    await supportApi.listMine(signal);

    expect(requestMock).toHaveBeenCalledWith(
      "/feedback",
      { signal },
      expect.anything(),
    );
  });

  it("санитизация/валидация (400 VALIDATION_FAILED) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("Invalid feedback payload", "VALIDATION_FAILED", 400),
    );

    await expect(
      supportApi.create({ subject: "x", text: "y" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("rate-limit (429 с retryAfterMs) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("Too many requests", "RATE_LIMITED", 429, 45_000),
    );

    await expect(
      supportApi.create({ subject: "x", text: "y" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterMs: 45_000 });
  });

  it("unauthorized (401) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(new ApiError("Unauthorized", undefined, 401));

    await expect(supportApi.listMine()).rejects.toMatchObject({ status: 401 });
  });
});

describe("reportsApi (Telegram)", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("create: POST /reports с JSON-телом и reportSchema", async () => {
    const report = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      targetType: "trip",
      targetId: "t-1",
      category: "safety",
      description: "Опасное вождение",
      status: "pending",
      resolutionNote: null,
      createdAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T10:00:00.000Z",
      resolvedAt: null,
    };
    requestMock.mockResolvedValue(report);
    const payload = {
      targetType: "trip",
      targetId: "t-1",
      category: "safety",
      description: "Опасное вождение",
    } as const;

    const result = await reportsApi.create(payload);

    expect(requestMock).toHaveBeenCalledWith(
      "/reports",
      { method: "POST", body: JSON.stringify(payload) },
      reportSchema,
    );
    expect(result.status).toBe("pending");
  });

  it("listMine идёт на GET /reports с сигналом", async () => {
    const signal = new AbortController().signal;
    requestMock.mockResolvedValue([]);

    await reportsApi.listMine(signal);

    expect(requestMock).toHaveBeenCalledWith(
      "/reports",
      { signal },
      expect.anything(),
    );
  });

  it("duplicate (409 CONFLICT) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("A report for this target already exists", "CONFLICT", 409),
    );

    await expect(
      reportsApi.create({
        targetType: "trip",
        targetId: "t-1",
        category: "safety",
        description: "Повтор",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("нет связи с объектом (403 FORBIDDEN) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("Report is not allowed in this context", "FORBIDDEN", 403),
    );

    await expect(
      reportsApi.create({
        targetType: "trip",
        targetId: "t-own",
        category: "spam",
        description: "Своя поездка",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("rate-limit отчётного лимитера (429) пробрасывается вызывающему", async () => {
    requestMock.mockRejectedValue(
      new ApiError("Too many requests", "RATE_LIMITED", 429),
    );

    await expect(reportsApi.listMine()).rejects.toMatchObject({ status: 429 });
  });
});
