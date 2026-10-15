import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequest, mockGetToken, mockStoreGetState, mockGetRawInitData } =
  vi.hoisted(() => ({
    mockRequest: vi.fn(),
    mockGetToken: vi.fn(),
    mockStoreGetState: vi.fn(),
    mockGetRawInitData: vi.fn(),
  }));

vi.mock("@/api/client", () => ({
  apiClient: { request: mockRequest, getToken: mockGetToken },
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

vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: { getState: mockStoreGetState },
}));

vi.mock("@/utils/telegram-adapter", () => ({
  getRawInitData: mockGetRawInitData,
}));

import { apiClient } from "@/api/client";
import { supportApi } from "@/api/support";
import { submitSupportFeedback } from "@/queries/useSupportQuery";
import { createFeedbackResponseSchema } from "@edem/contracts";

const requestMock = vi.mocked(apiClient.request);

const created = { id: "f-1", createdAt: "2026-09-09T10:00:00.000Z" };
const dto = { subject: "Обжалование блокировки", text: "Прошу пересмотреть" };
const RAW_INIT_DATA = "user=%7B%22id%22%3A1%7D&hash=dev-hash";

beforeEach(() => {
  requestMock.mockReset();
  mockGetToken.mockReset();
  mockStoreGetState.mockReset();
  mockGetRawInitData.mockReset();
  // По умолчанию SDK initData недоступна (вне Telegram) — иначе фолбэк
  // маскировал бы тест «initData в сторе». Кейсы с фолбэком задают сами.
  mockGetRawInitData.mockReturnValue(undefined);
});

describe("supportApi.appeal (TG-ветка POST /feedback/appeal)", () => {
  it("шлёт initData + subject + text с JSON-телом и схемой ответа", async () => {
    requestMock.mockResolvedValue(created);

    await supportApi.appeal({ initData: RAW_INIT_DATA, ...dto });

    expect(requestMock).toHaveBeenCalledWith(
      "/feedback/appeal",
      { method: "POST", body: JSON.stringify({ initData: RAW_INIT_DATA, ...dto }) },
      createFeedbackResponseSchema,
    );
  });

  it("401 (битая подпись) пробрасывается вызывающему", async () => {
    const { ApiError } = await import("@/api/client");
    requestMock.mockRejectedValue(new ApiError("Invalid or expired signature", undefined, 401));

    await expect(supportApi.appeal({ initData: "hash=wrong", ...dto })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("429 appeal-лимитера пробрасывается вызывающему", async () => {
    const { ApiError } = await import("@/api/client");
    requestMock.mockRejectedValue(new ApiError("Too many requests", "RATE_LIMITED", 429));

    await expect(supportApi.appeal({ initData: RAW_INIT_DATA, ...dto })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
  });
});

describe("submitSupportFeedback: канал выбирает ВЫЗЫВАЮЩИЙ", () => {
  it("channel=session → supportApi.create, appeal не вызывается", async () => {
    mockGetToken.mockReturnValue("access-token");
    requestMock.mockResolvedValue(created);

    const result = await submitSupportFeedback(dto, "session");

    expect(result).toEqual(created);
    expect(requestMock).toHaveBeenCalledWith(
      "/feedback",
      { method: "POST", body: JSON.stringify(dto) },
      createFeedbackResponseSchema,
    );
    expect(requestMock).not.toHaveBeenCalledWith(
      "/feedback/appeal",
      expect.anything(),
      expect.anything(),
    );
  });

  /**
   * Регрессия F2: бан mid-session — токен в apiClient ещё валиден (JWT
   * stateless, бан не приходит в открытый WS, emitBanned живёт только в
   * performRefresh), но апелляция обязана уйти в публичный /feedback/appeal.
   * Старая реализация выводила канал из наличия токена и уводила её в
   * requireUser → 403 в тупик до истечения токена (~15 мин).
   * Токен здесь намеренно НЕ пустой — именно этот случай регрессировал.
   */
  it("channel=appeal при ЖИВОМ токене → appeal, а не requireUser (регрессия F2)", async () => {
    mockGetToken.mockReturnValue("access-token");
    mockStoreGetState.mockReturnValue({ initData: RAW_INIT_DATA });
    requestMock.mockResolvedValue(created);

    const result = await submitSupportFeedback(dto, "appeal");

    expect(result).toEqual(created);
    expect(requestMock).toHaveBeenCalledWith(
      "/feedback/appeal",
      { method: "POST", body: JSON.stringify({ initData: RAW_INIT_DATA, ...dto }) },
      createFeedbackResponseSchema,
    );
    expect(requestMock).not.toHaveBeenCalledWith(
      "/feedback",
      expect.anything(),
      expect.anything(),
    );
  });

  it("channel=appeal: initData из стора → { initData, ...dto }", async () => {
    mockStoreGetState.mockReturnValue({ initData: RAW_INIT_DATA });
    requestMock.mockResolvedValue(created);

    const result = await submitSupportFeedback(dto, "appeal");

    expect(result).toEqual(created);
    expect(requestMock).toHaveBeenCalledWith(
      "/feedback/appeal",
      { method: "POST", body: JSON.stringify({ initData: RAW_INIT_DATA, ...dto }) },
      createFeedbackResponseSchema,
    );
  });

  it("channel=appeal без initData и в сторе, и в SDK → throw, сеть не вызывается", async () => {
    mockStoreGetState.mockReturnValue({ initData: null });

    await expect(submitSupportFeedback(dto, "appeal")).rejects.toThrow(
      "Не удалось отправить обращение",
    );
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("channel=appeal: initData в сторе null, но SDK её отдаёт → appeal уходит с SDK-строкой", async () => {
    // Ветка «403 на /feedback» в стор не заходит: initData берём из SDK.
    mockStoreGetState.mockReturnValue({ initData: null });
    mockGetRawInitData.mockReturnValue(RAW_INIT_DATA);
    requestMock.mockResolvedValue(created);

    const result = await submitSupportFeedback(dto, "appeal");

    expect(result).toEqual(created);
    expect(requestMock).toHaveBeenCalledWith(
      "/feedback/appeal",
      { method: "POST", body: JSON.stringify({ initData: RAW_INIT_DATA, ...dto }) },
      createFeedbackResponseSchema,
    );
  });

  it("channel=appeal: initData в сторе приоритетнее SDK-строки", async () => {
    mockStoreGetState.mockReturnValue({ initData: "from-store" });
    mockGetRawInitData.mockReturnValue(RAW_INIT_DATA);
    requestMock.mockResolvedValue(created);

    await submitSupportFeedback(dto, "appeal");

    expect(requestMock).toHaveBeenCalledWith(
      "/feedback/appeal",
      { method: "POST", body: JSON.stringify({ initData: "from-store", ...dto }) },
      createFeedbackResponseSchema,
    );
  });
});
