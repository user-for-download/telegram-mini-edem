import { create } from "zustand";
import { getRawInitData, purgeLaunchParamsCache } from "@/utils/telegram-adapter";
import type { User } from "@/types";
import { authApi } from "@/api/auth.api";
import { ApiError, apiClient } from "@/api/client";
import type { AuthResponse, TelegramAuthRequest } from "@edem/contracts";

export type AuthStatus =
  | "idle"
  | "initializing"
  | "authenticated"
  | "unauthenticated"
  | "error"
  | "background"
  | "banned"
  | "deleted";

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  /**
   * Причина бана (PII). null — бан без причины (старые баны) или бан ещё
   * не детектирован. Подбирается из 403-ответа бэкенда при bootstrap или
   * при refresh-403 через apiClient.onBanned. Не логируется.
   */
  banReason: string | null;
  /**
   * Сырая initData Telegram, с которой открыт мини-апп. Заполняется при
   * бане (applyBanned) — будущие appeal-сценарии забаненного подписываются
   * ею же (та же подпись, что в /auth/telegram). В остальных состояниях
   * null. Не логируется. В dev вне Telegram — mock-строка из mockEnv.ts.
   */
  initData: string | null;
  /**
   * Последняя ошибка bootstrap (для различения UI: 429 rate-limit,
   * сеть, 503 not configured). Null — ошибки не было или был успех.
   */
  lastAuthError: { status?: number; code?: string } | null;
  bootstrap: () => Promise<void>;
  refreshSession: () => Promise<void>;
  handleBackgroundState: (isHidden: boolean) => void;
  clearSession: (reason?: string) => Promise<void>;
  /**
   * Терминальное состояние после успешного DELETE /users/me: отдельный экран
   * «Профиль удалён» вместо «Ошибки авторизации» (иначе ретрай зацикливался
   * бы: /auth/telegram отвечает удалённому аккаунту 403).
   */
  markAccountDeleted: () => void;
}

let bootstrapPromise: Promise<void> | null = null;
let refreshPromise: Promise<void> | null = null;

/**
 * Строит auth-payload: initData РОВНО как её передал Telegram — без
 * пересортировки ключей и перекодировки, иначе HMAC на сервере не сойдётся.
 * Сырую строку отдаёт telegram-adapter (fail-closed: вне Telegram — undefined).
 *
 * Вне Telegram (браузерный dev) SDK работает на mockTelegramEnv (mockEnv.ts):
 * там лежит dev-строка с hash=dev-hash для dev-bypass бэкенда. Если SDK
 * не инициализирован или launch params отсутствуют — bootstrap неуспешен.
 */
async function getTelegramAuthPayload(): Promise<TelegramAuthRequest> {
  const raw = getRawInitData();

  if (!raw) {
    throw new Error("Telegram init data is unavailable");
  }

  return { initData: raw };
}

/**
 * Обрабатывает 403 FORBIDDEN из bootstrap: пользователь забанен, нужно
 * показать плашку «Аккаунт заблокирован» с причиной из тела ответа.
 * banReason — PII, в лог не выводим. Возвращает true, если ошибка была
 * распознана как бан; иначе вызывающий код обрабатывает её как обычный сбой.
 */
function isBannedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && error.code === "FORBIDDEN";
}

/**
 * Распознаёт 403 удалённого аккаунта из bootstrap: код совпадает с баном
 * (FORBIDDEN), различаем по message ("Account is deleted"). Проверять ДО
 * isBannedError, иначе удалённый аккаунт попадёт на плашку бана.
 */
const ACCOUNT_DELETED_MESSAGE = "Account is deleted";

function isDeletedError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.message === ACCOUNT_DELETED_MESSAGE
  );
}

function applyAuthenticated(set: (state: Partial<AuthState>) => void, response: AuthResponse) {
  apiClient.setSession(response);
  set({
    status: "authenticated",
    user: response.user as User,
    session: {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
    },
    banReason: null,
    initData: null,
    lastAuthError: null,
  });
}

function applyBanned(
  set: (state: Partial<AuthState>) => void,
  error: ApiError,
  initData: string | null,
) {
  console.error("[Auth] Bootstrap failed: account is banned");
  apiClient.setSession(null);
  set({
    status: "banned",
    user: null,
    session: null,
    banReason: error.banReason ?? null,
    initData,
  });
}

function applyDeleted(set: (state: Partial<AuthState>) => void) {
  console.log("[Auth] Account is deleted");
  apiClient.setSession(null);
  set({
    status: "deleted",
    user: null,
    session: null,
    banReason: null,
    initData: null,
  });
}

function applyUnauthenticated(set: (state: Partial<AuthState>) => void, error?: unknown) {
  apiClient.setSession(null);
  set({
    status: "unauthenticated",
    user: null,
    session: null,
    initData: null,
    lastAuthError:
      error instanceof ApiError
        ? { status: error.status, code: error.code }
        : { status: undefined, code: error instanceof Error && error.message.includes("init data") ? "INIT_DATA_UNAVAILABLE" : undefined },
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "idle",
  user: null,
  session: null,
  banReason: null,
  initData: null,
  lastAuthError: null,

  bootstrap: async () => {
    if (bootstrapPromise) {
      return bootstrapPromise;
    }

    bootstrapPromise = (async () => {
      const currentStatus = get().status;

      if (currentStatus === "authenticated" || currentStatus === "initializing") {
        return;
      }

      set({ status: "initializing" });

      // InitData подбираем ДО попытки логина: при бане логин
      // отклоняется 403, но строка пригодится для подписи appeal.
      let initData: string | null = null;

      try {
        const payload = await getTelegramAuthPayload();
        initData = payload.initData;
        const response = await authApi.loginWithTelegram(payload);
        applyAuthenticated(set, response);
      } catch (error) {
        // Удалённый аккаунт проверяем раньше бана: code совпадает (FORBIDDEN).
        if (isDeletedError(error)) {
          applyDeleted(set);
          return;
        }
        if (isBannedError(error)) {
          applyBanned(set, error, initData);
          return;
        }
        console.error("[Auth] Bootstrap failed:", error);
        applyUnauthenticated(set, error);
      }
    })().finally(() => {
      bootstrapPromise = null;
    });

    return bootstrapPromise;
  },

  refreshSession: async () => {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      const state = get();

      if (!state.session?.refreshToken) {
        await get().clearSession("No refresh token");
        return;
      }

      try {
        console.log("[Auth] Refreshing session...");

        // Локальная подписка на обновлённые токены: стор обновляет session
        // сам и не зависит от подписки гейта (её может не быть, если гейт
        // размонтирован). Подписка одноразовая — снимается в finally ниже.
        // Дублирующее обновление из гейта идемпотентно (те же значения).
        const unsubscribe = apiClient.onTokenUpdate((tokens) => {
          if (get().status === "unauthenticated" || get().status === "error" || get().status === "deleted") {
            return;
          }
          set({
            status: "authenticated",
            // Refresh возвращает свежего user (имя/аватар могли измениться) —
            // подхватываем, иначе стор хранит устаревшее до следующего
            // bootstrap. Каст — как в applyAuthenticated.
            user: tokens.user ? (tokens.user as User) : get().user,
            session: {
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt: Date.now() + tokens.expiresIn * 1000,
            },
          });
        });

        try {
          // Единая точка refresh — apiClient.tryRefresh() (single-flight):
          // тот же путь, что и при 401/WS-сбое. Ротация токенов происходит
          // один раз.
          apiClient.setSession(state.session);

          const refreshResult = await apiClient.tryRefresh();

          if (refreshResult === "permanent-rejection") {
            // Бан (403 FORBIDDEN) идёт тем же путём: onBanned уже выставил
            // status="banned" — не затираем плашку бана логаутом.
            // Удалённый аккаунт — аналогично: onDeleted уже выставил
            // status="deleted" (экран «Профиль удалён»).
            if (get().status === "banned" || get().status === "deleted") {
              return;
            }
            await get().clearSession("Refresh failed");
          } else if (refreshResult === "transient-failure") {
            // Транзиентный сбой (сеть/5xx/невалидный ответ): сессию НЕ
            // сбрасываем — следующий запрос повторит refresh и восстановится.
            // Возвращаем только активный статус; user/session не трогаем.
            if (get().status !== "banned") {
              set({ status: "authenticated" });
            }
          }
          // success: session уже обновлена через onTokenUpdate выше.
        } finally {
          unsubscribe();
        }
      } catch (error) {
        console.error("[Auth] Refresh failed:", error);
        if (get().status !== "banned") {
          set({ status: "authenticated" });
        }
      }
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  },

  handleBackgroundState: (isHidden) => {
    // Удалённый аккаунт терминален: фоновые проверки не должны сбрасывать
    // экран «Профиль удалён» в «Ошибку авторизации».
    if (get().status === "deleted") {
      return;
    }
    const state = get();

    if (isHidden) {
      if (state.status === "authenticated") {
        console.log("[Auth] App going to background");
        set({ status: "background" });
      }
      return;
    }

    if (state.status === "background") {
      console.log("[Auth] App restored from background, validating session...");

      if (!state.session) {
        set({ status: "unauthenticated", user: null, session: null });
        return;
      }

      if (state.session.expiresAt < Date.now()) {
        set({ status: "initializing" });
        void get().refreshSession();
      } else {
        set({ status: "authenticated" });
      }
    }
  },

  clearSession: async (reason) => {
    console.log(`[Auth] Clearing session. Reason: ${reason}`);

    // In-flight refresh не должен воскресить сессию после логаута.
    apiClient.invalidatePendingRefresh();
    apiClient.setSession(null);

    // SDK-кэш launch params с сырой initData переживает logout
    // (bridge пишет sessionStorage["tapps/launchParams"], сам не чистит) —
    // пуржим, иначе «материал сессии» остаётся в табе.
    purgeLaunchParamsCache();

    set({
      status: "unauthenticated",
      user: null,
      session: null,
      banReason: null,
      initData: null,
      lastAuthError: reason === "Session expired" ? { code: "SESSION_EXPIRED" } : null,
    });
  },

  markAccountDeleted: () => {
    apiClient.invalidatePendingRefresh();
    purgeLaunchParamsCache();
    applyDeleted(set);
  },
}));
