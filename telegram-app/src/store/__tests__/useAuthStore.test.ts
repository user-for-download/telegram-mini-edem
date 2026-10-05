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
  purgeLaunchParamsCache: vi.fn(),
}));

// Сетевая граница refresh: apiClient подменяем (tryRefresh нельзя вести
// по-настоящему — нужен контролируемый результат и гонка с logout).
// ApiError берём ОРИГИНАЛЬНЫЙ (importOriginal), иначе instanceof в сторе
// перестал бы работать и ветки banned/deleted стали бы мёртвыми.
const { mockTryRefresh, mockSetSession, mockInvalidatePendingRefresh } =
  vi.hoisted(() => ({
    mockTryRefresh: vi.fn(),
    mockSetSession: vi.fn(),
    mockInvalidatePendingRefresh: vi.fn(),
  }));

vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>();
  return {
    ...original,
    apiClient: {
      setToken: vi.fn(),
      setRefreshToken: vi.fn(),
      setSession: mockSetSession,
      getToken: vi.fn(),
      isRefreshing: () => false,
      onTokenUpdate: vi.fn(() => () => {}),
      onSessionExpired: vi.fn(() => () => {}),
      onBanned: vi.fn(() => () => {}),
      onDeleted: vi.fn(() => () => {}),
      onRefreshStart: vi.fn(() => () => {}),
      onRefreshEnd: vi.fn(() => () => {}),
      invalidatePendingRefresh: mockInvalidatePendingRefresh,
      tryRefresh: mockTryRefresh,
      request: vi.fn(),
    },
  };
});

import { ACCOUNT_DELETED_CODE, ApiError } from "@/api/client";
import type { RefreshResult } from "@/api/client";
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
    lastAuthError: null,
  });
  mockedLoginWithTelegram.mockReset();
  mockedGetRawInitData.mockReset();
  mockedGetRawInitData.mockReturnValue(RAW_INIT_DATA);
  mockTryRefresh.mockReset();
  mockSetSession.mockReset();
  mockInvalidatePendingRefresh.mockReset();
}

/** Сессия в фоне: refresh «завис» в полёте, logout приходит параллельно. */
function seedBackgroundSession() {
  useAuthStore.setState({
    status: "background",
    user: validUser,
    session: {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 900_000,
    },
    banReason: null,
    initData: null,
  });
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

  it("403 по КОДУ ACCOUNT_DELETED: deleted, даже если текст переписан", async () => {
    // Новая ветка: код различает удаление и бан, текст больше не решает.
    mockedLoginWithTelegram.mockRejectedValue(
      new ApiError("Аккаунт недоступен", ACCOUNT_DELETED_CODE, 403),
    );

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState().status).toBe("deleted");
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


/**
 * B6: результат refresh нельзя применять, если сессию уже сняли.
 * Гонка реальная: пользователь уходит в фон, возврат инициирует refresh,
 * а параллельно приходит logout / отзыв токена / бан. apiClient отсекает
 * подмену токенов (refreshGeneration), но статус не сторожит — без
 * проверки session транзиентный сбой возвращал status="authenticated"
 * при session === null, и приложение рендерилось без токена.
 */
describe("useAuthStore.refreshSession: сессия снята параллельно (B6)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transient-failure после logout не воскрешает 'authenticated'", async () => {
    let settle: (result: RefreshResult) => void = () => {};
    mockTryRefresh.mockReturnValue(
      new Promise<RefreshResult>((resolve) => {
        settle = resolve;
      }),
    );
    seedBackgroundSession();

    const inflight = useAuthStore.getState().refreshSession();
    // Даём refreshSession дойти до await tryRefresh.
    await vi.waitFor(() => expect(mockTryRefresh).toHaveBeenCalledTimes(1));

    await useAuthStore.getState().clearSession("logout");
    expect(useAuthStore.getState().status).toBe("unauthenticated");

    // Refresh завершается транзиентно (сеть/5xx) — состояние не меняем.
    settle("transient-failure");
    await inflight;

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.session).toBeNull();
  });

  it("permanent-rejection после logout не затирает маркер SESSION_EXPIRED", async () => {
    // Гонка обязательна: при мгновенном refresh ветка permanent-rejection
    // отработала бы ДО logout и тест прошёл бы на любом коде.
    let settle: (result: RefreshResult) => void = () => {};
    mockTryRefresh.mockReturnValue(
      new Promise<RefreshResult>((resolve) => {
        settle = resolve;
      }),
    );
    seedBackgroundSession();

    const inflight = useAuthStore.getState().refreshSession();
    await vi.waitFor(() => expect(mockTryRefresh).toHaveBeenCalledTimes(1));
    await useAuthStore.getState().clearSession("Session expired");

    settle("permanent-rejection");
    await inflight;

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.lastAuthError).toEqual({ code: "SESSION_EXPIRED" });
  });

  it("transient-failure при живой сессии возвращает активный статус", async () => {
    mockTryRefresh.mockResolvedValue("transient-failure");
    seedBackgroundSession();

    await useAuthStore.getState().refreshSession();

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.session?.refreshToken).toBe("refresh-1");
    // Сессию не сбрасываем — следующий запрос повторит refresh.
    expect(state.lastAuthError).toBeNull();
  });

  it("permanent-rejection при живой сессии сбрасывает её", async () => {
    mockTryRefresh.mockResolvedValue("permanent-rejection");
    seedBackgroundSession();

    await useAuthStore.getState().refreshSession();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("бан во время refresh не затирается логаутом", async () => {
    let settle: (result: RefreshResult) => void = () => {};
    mockTryRefresh.mockReturnValue(
      new Promise<RefreshResult>((resolve) => {
        settle = resolve;
      }),
    );
    seedBackgroundSession();

    const inflight = useAuthStore.getState().refreshSession();
    await vi.waitFor(() => expect(mockTryRefresh).toHaveBeenCalledTimes(1));

    // apiClient.onBanned уже выставил статус и обнулил сессию.
    useAuthStore.setState({
      status: "banned",
      user: null,
      session: null,
      banReason: "Спам",
    });

    settle("permanent-rejection");
    await inflight;

    const state = useAuthStore.getState();
    expect(state.status).toBe("banned");
    expect(state.banReason).toBe("Спам");
  });

  it("без refresh-токена refreshSession сразу чистит сессию", async () => {
    useAuthStore.setState({
      status: "background",
      user: validUser,
      session: {
        accessToken: "access-1",
        refreshToken: "",
        expiresAt: Date.now() - 1,
      },
    });

    await useAuthStore.getState().refreshSession();

    expect(mockTryRefresh).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });
});
