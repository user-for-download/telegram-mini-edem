import { create } from "zustand";
import { getRawInitData, purgeLaunchParamsCache } from "@/utils/telegram-adapter";
import { log } from "@/utils/log";
import type { User } from "@/types";
import { authApi } from "@/api/auth.api";
import {
  ApiError,
  isAccountDeletedError,
  apiClient,
} from "@/api/client";
import type { AuthResponse, TelegramAuthRequest } from "@edem/contracts";

/**
 * Статусы авторизации. Состояния "error" нет: сбой авторизации — это
 * либо терминальный экран (banned/deleted), либо обычный
 * "unauthenticated" с lastAuthError для различения причины
 * (429 / SESSION_EXPIRED / INIT_DATA_UNAVAILABLE).
 */
export type AuthStatus =
  | "idle"
  | "initializing"
  | "authenticated"
  | "unauthenticated"
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
  lastAuthError: {
    status?: number;
    code?: string;
    /** Сколько ждать по ответу лимитера (429) — AuthGate отсчитывает по нему. */
    retryAfterMs?: number;
  } | null;
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
  /**
   * Переход в «забанен» из активной сессии: 403 FORBIDDEN от /auth/refresh
   * (событие apiClient `banned`) и терминальный WS-close 4403.
   *
   * Отдельное действие, а не `setState` в подписчиках: заполнение
   * initData для апелляции нельзя забыть (см. applyBanned).
   */
  markBanned: (banReason: string | null) => void;
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
 * Распознаёт 403 удалённого аккаунта из bootstrap. Различение удаления и
 * бана живёт в `isAccountDeletedError` (по коду ACCOUNT_DELETED, с
 * фолбэком на текст для старого бэка). Проверять ДО isBannedError.
 */
function isDeletedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && isAccountDeletedError(error);
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

/**
 * Терминальный переход «забанен» — ЕДИНАЯ точка для всех путей бана.
 *
 * initData берётся здесь же: обжалование уходит через публичный
 * POST /feedback/appeal БЕЗ токена, и личность подтверждается той же
 * сырой initData-строкой. Бан из активной сессии (WS 4403 или 403
 * от /auth/refresh) обязан заполнить её так же, как bootstrap,
 * иначе форма обжалования падает, не отправив ни одного запроса.
 *
 * Сырая строка, без пересортировки (HMAC), и БЕЗ purgeLaunchParamsCache:
 * бан — не логаут, материал сессии нужен для апелляции.
 */
function applyBanned(
  set: (state: Partial<AuthState>) => void,
  banReason: string | null,
  initData: string | null,
) {
  console.error("[Auth] Account is banned");
  apiClient.setSession(null);
  set({
    status: "banned",
    user: null,
    session: null,
    banReason,
    initData: initData ?? getRawInitData() ?? null,
  });
}

function applyDeleted(set: (state: Partial<AuthState>) => void) {
  log("[Auth] Account is deleted");
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
        ? {
            status: error.status,
            code: error.code,
            // Без этого поле отсчёт на 429 угадывал бы длину окна.
            retryAfterMs: error.retryAfterMs,
          }
        : {
            status: undefined,
            code:
              error instanceof Error && error.message.includes("init data")
                ? "INIT_DATA_UNAVAILABLE"
                : undefined,
            retryAfterMs: undefined,
          },
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
          applyBanned(set, error.banReason ?? null, initData);
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
        log("[Auth] Refreshing session...");

        // Локальная подписка на обновлённые токены: стор обновляет session
        // сам и не зависит от подписки гейта (её может не быть, если гейт
        // размонтирован). Подписка одноразовая — снимается в finally ниже.
        // Дублирующее обновление из гейта идемпотентно (те же значения).
        const unsubscribe = apiClient.onTokenUpdate((tokens) => {
          if (
            get().status === "unauthenticated" ||
            get().status === "deleted"
          ) {
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

          // Сессию могли снять параллельно, пока шёл запрос: logout,
          // отзыв refresh-токена, бан или удаление. Тогда результату
          // refresh нечего применять — нужное состояние уже установлено,
          // и трогать его нельзя. Сторожит именно session: проверка
          // refreshGeneration в apiClient отсекает подмену токенов, но
          // статус не сторожит, поэтому без этой проверки транзиентный
          // сбой возвращал бы status="authenticated" при session === null.
          if (!get().session) return;

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
            // Сессия гарантированно на месте — Early return выше.
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
        // Тот же контракт, что и выше: без сессии состояние не трогаем.
        if (get().status !== "banned" && get().session) {
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
        log("[Auth] App going to background");
        set({ status: "background" });
      }
      return;
    }

    if (state.status === "background") {
      log("[Auth] App restored from background, validating session...");

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
    log(`[Auth] Clearing session. Reason: ${reason}`);

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

  markBanned: (banReason) => {
    // In-flight refresh не должен воскресить сессию после бана.
    apiClient.invalidatePendingRefresh();
    // initData не передаём: applyBanned возьмёт сырую строку из SDK —
    // это один путь и для bootstrap, и для бана в активной сессии.
    applyBanned(set, banReason, null);
  },
}));
