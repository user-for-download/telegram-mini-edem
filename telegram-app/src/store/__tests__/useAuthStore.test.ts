import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Мокаем сетевую границу стора (authApi) и границу SDK (telegram-adapter) —
// тестируем «как стор реагирует на результат сети» и что initData передаётся
// на бэкенд РОВНО как её отдал SDK (без пересортировки — иначе HMAC).
vi.mock("@/api/auth.api", () => ({
  authApi: {
    loginWithTelegram: vi.fn(),
    refreshToken: vi.fn(),
  },
}));

vi.mock("@/utils/telegram-adapter", () => ({
  getRawInitData: vi.fn(),
}));

import { ApiError } from "@/api/client";
import { authApi } from "@/api/auth.api";
import { getRawInitData } from "@/utils/telegram-adapter";
import { useAuthStore } from "@/store/useAuthStore";
import type { AuthResponse } from "@edem/contracts";

const mockedLoginWithTelegram = vi.mocked(authApi.loginWithTelegram);
const mockedGetRawInitData = vi.mocked(getRawInitData);

// Сырая initData-строка EXACTLY как от Telegram/mockEnv (query-params,
// urlencoded user JSON). RAW-passthrough тест ниже сверяет, что стор
// передаёт её в loginWithTelegram побайтово.
const RAW_INIT_DATA =
  "user=%7B%22id%22%3A9800001%2C%22first_name%22%3A%22Dev%22%7D" +
  "&auth_date=1788947253&hash=dev-hash";

const validUser = {
  id: "user-1",
  name: "Dev Telegram",
  avatar: "https://t.me/i/userpic/320/x.svg",
  rating: 5,
  reviewsCount: 0,
  tripsCount: 0,
  isVerified: true,
  notificationsEnabled: true,
  verifiedAt: null,
  onboardingVersion: null,
  car: undefined,
  about: undefined,
  createdAt: "2026-09-09T00:00:00.000Z",
};

const validAuthResponse: AuthResponse = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 900,
  user: validUser,
};

function bannedError(banReason: string | null | undefined): ApiError {
  return new ApiError("Account is banned", "FORBIDDEN", 403, undefined, banReason);
}

function resetStore() {
  useAuthStore.setState({
    status: "idle",
    user: null,
    session: null,
    banReason: null,
    initData: null,
  });
  mockedLoginWithTelegram.mockReset();
  mockedGetRawInitData.mockReset();
  mockedGetRawInitData.mockReturnValue(RAW_INIT_DATA);
}

describe("useAuthStore.bootstrap (Telegram)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("успешный логин: authenticated + user/session заполнены", async () => {
    mockedLoginWithTelegram.mockResolvedValue(validAuthResponse);

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.user).toEqual(validUser);
    expect(state.session?.accessToken).toBe("access-1");
    expect(state.session?.refreshToken).toBe("refresh-1");
    expect(state.banReason).toBeNull();
  });

  it("initData передаётся на бэкенд RAW, без пересортировки (HMAC)", async () => {
    mockedLoginWithTelegram.mockResolvedValue(validAuthResponse);

    await useAuthStore.getState().bootstrap();

    expect(mockedLoginWithTelegram).toHaveBeenCalledTimes(1);
    const loginCall = mockedLoginWithTelegram.mock.calls[0];
    if (!loginCall) throw new Error("loginWithTelegram was not called");
    expect(loginCall[0]).toEqual({
      initData: RAW_INIT_DATA,
    });
  });

  it("403 FORBIDDEN с banReason: banned + причина сохранена", async () => {
    mockedLoginWithTelegram.mockRejectedValue(bannedError("Спам"));

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe("banned");
    expect(state.banReason).toBe("Спам");
    expect(state.user).toBeNull();
    expect(state.session).toBeNull();
  });

  it("403 FORBIDDEN без banReason: banned, banReason === null", async () => {
    mockedLoginWithTelegram.mockRejectedValue(
      new ApiError("Account is banned", "FORBIDDEN", 403),
    );

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe("banned");
    expect(state.banReason).toBeNull();
  });

  it("403 Account is deleted: терминальный deleted (проверяется раньше бана)", async () => {
    mockedLoginWithTelegram.mockRejectedValue(
      new ApiError("Account is deleted", "FORBIDDEN", 403),
    );

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe("deleted");
    expect(state.user).toBeNull();
  });

  it("SDK без init data (вне Telegram): unauthenticated, без сетевых вызовов", async () => {
    mockedGetRawInitData.mockReturnValue(undefined);

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(mockedLoginWithTelegram).not.toHaveBeenCalled();
  });

  it("сетевая ошибка: unauthenticated, бан не выставлен", async () => {
    mockedLoginWithTelegram.mockRejectedValue(new Error("network down"));

    await useAuthStore.getState().bootstrap();

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.banReason).toBeNull();
  });
});
