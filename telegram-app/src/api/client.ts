import type { ZodType } from "zod";
import { authResponseSchema, type AuthResponse } from "@edem/contracts";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

/**
 * Достаёт `banReason` из тела ошибки, если бэкенд прислал 403-ответ формата
 * `{ code: "FORBIDDEN", banReason: string | null }`. На любых не-бан ответах
 * (другие коды, отсутствие поля, не-строковое значение) возвращает `null` —
 * `banReason` остаётся `undefined`/null для не-бан ошибок, что позволяет
 * стору различать «забанен» и «обычная 403».
 */
function readBanReason(errorData: unknown): string | null {
  if (!errorData || typeof errorData !== "object") return null;
  const reason = Reflect.get(errorData, "banReason");
  if (typeof reason === "string") return reason;
  return null;
}

export class ApiError extends Error {
  code?: string;
  status?: number;
  retryAfterMs?: number;
  /**
   * Причина бана (PII) — присутствует только в 403-ответах от /auth/telegram и
   * /auth/refresh, когда бэкенд вернул `{ code: "FORBIDDEN", banReason: ... }`.
   * Для всех остальных ошибок поле остаётся undefined.
   */
  banReason?: string | null;
  constructor(
    message: string,
    code?: string,
    status?: number,
    retryAfterMs?: number,
    banReason?: string | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.banReason = banReason;
  }
}

export interface TokenUpdate {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /**
   * Свежий user из /auth/refresh (бэкенд возвращает полный AuthResponse).
   * Опционален: подписчики обязаны держать текущий user как fallback.
   */
  user?: AuthResponse["user"];
}

export type RefreshResult = "success" | "permanent-rejection" | "transient-failure";

type TokenUpdateListener = (tokens: TokenUpdate) => void;
type BannedListener = (banReason: string | null) => void;

export class ApiClient {
  private token: string | null = null;
  private refreshTokenValue: string | null = null;
  private refreshPromise: Promise<RefreshResult> | null = null;
  private refreshGeneration = 0;
  private tokenListeners: Set<TokenUpdateListener> = new Set();
  private sessionExpiredListeners: Set<() => void> = new Set();
  private bannedListeners: Set<BannedListener> = new Set();
  private refreshStartListeners: Set<() => void> = new Set();
  private refreshEndListeners: Set<(result: RefreshResult) => void> = new Set();

  setToken(token: string | null) {
    this.token = token;
  }

  setRefreshToken(token: string | null) {
    this.refreshTokenValue = token;
  }

  setSession(tokens: { accessToken: string; refreshToken: string } | null) {
    this.token = tokens?.accessToken ?? null;
    this.refreshTokenValue = tokens?.refreshToken ?? null;
  }

  getToken(): string | null {
    return this.token;
  }

  /**
   * Подписка на тихие обновления токенов (silent refresh).
   * Возвращает функцию отписки.
   */
  onTokenUpdate(listener: TokenUpdateListener): () => void {
    this.tokenListeners.add(listener);
    return () => this.tokenListeners.delete(listener);
  }

  private emitTokenUpdate(tokens: TokenUpdate) {
    this.tokenListeners.forEach((listener) => {
      try {
        listener(tokens);
      } catch (err) {
        console.error("[ApiClient] tokenUpdate listener error:", err);
      }
    });
  }

  /**
   * Подписка на необратимый отказ refresh (401 от /auth/refresh):
   * токен отозван/истёк, сессию нужно сбросить, иначе приложение
   * навсегда застревает с мёртвыми токенами.
   */
  onSessionExpired(listener: () => void): () => void {
    this.sessionExpiredListeners.add(listener);
    return () => this.sessionExpiredListeners.delete(listener);
  }

  private emitSessionExpired() {
    this.sessionExpiredListeners.forEach((listener) => listener());
  }

  /**
   * Подписка на обнаружение бана при refresh (403 + код FORBIDDEN от
   * /auth/refresh). Стор обновляет status="banned" + banReason сразу,
   * без ожидания повторного bootstrap.
   */
  onBanned(listener: BannedListener): () => void {
    this.bannedListeners.add(listener);
    return () => {
      this.bannedListeners.delete(listener);
    };
  }

  private emitBanned(banReason: string | null) {
    this.bannedListeners.forEach((listener) => {
      try {
        listener(banReason);
      } catch (err) {
        console.error("[ApiClient] banned listener error:", err);
      }
    });
  }

  /**
   * Единый источник refresh-состояния: идёт ли сейчас refresh-запрос.
   */
  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }

  /**
   * Подписка на начало refresh. Возвращает функцию отписки.
   */
  onRefreshStart(listener: () => void): () => void {
    this.refreshStartListeners.add(listener);
    return () => {
      this.refreshStartListeners.delete(listener);
    };
  }

  /**
   * Подписка на завершение refresh (успешного или нет).
   * Вызывается ОДИН раз на refresh — только у инициатора.
   */
  onRefreshEnd(listener: (result: RefreshResult) => void): () => void {
    this.refreshEndListeners.add(listener);
    return () => {
      this.refreshEndListeners.delete(listener);
    };
  }

  private emitRefreshStart(): void {
    this.refreshStartListeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error("[ApiClient] refreshStart listener error:", err);
      }
    });
  }

  private emitRefreshEnd(result: RefreshResult): void {
    this.refreshEndListeners.forEach((listener) => {
      try {
        listener(result);
      } catch (err) {
        console.error("[ApiClient] refreshEnd listener error:", err);
      }
    });
  }

  /**
   * Отменяет применение результатов in-flight refresh (пользователь вышел
   * из аккаунта, пока обновление токена выполнялось).
   */
  invalidatePendingRefresh() {
    this.refreshGeneration++;
  }

  async request<T>(endpoint: string, options: RequestInit = {}, schema: ZodType<T>): Promise<T> {
    const response = await this.doFetch(endpoint, options);

    // Если 401 и это НЕ сам auth-эндпоинт — пробуем refresh
    if (
      response.status === 401 &&
      !endpoint.startsWith("/auth/") &&
      this.refreshTokenValue
    ) {
      const refreshResult = await this.tryRefresh();
      if (refreshResult === "success") {
        // Повторяем исходный запрос с новым токеном
        const retryResponse = await this.doFetch(endpoint, options);
        if (!retryResponse.ok) {
          const errorData: unknown = await retryResponse.json().catch(() => ({}));
          const errorRecord = toErrorRecord(errorData);
          throw new ApiError(
            errorRecord.message ?? `HTTP error ${retryResponse.status}`,
            errorRecord.code,
            retryResponse.status,
            errorRecord.retryAfterMs,
            readBanReason(errorData),
          );
        }
        return this.parseResponse(retryResponse, schema);
      }
    }

    if (!response.ok) {
      const errorData: unknown = await response.json().catch(() => ({}));
      const errorRecord = toErrorRecord(errorData);
      throw new ApiError(
        errorRecord.message ?? `HTTP error ${response.status}`,
        errorRecord.code,
        response.status,
        errorRecord.retryAfterMs,
        readBanReason(errorData),
      );
    }

    return this.parseResponse(response, schema);
  }

  private async parseResponse<T>(response: Response, schema: ZodType<T>): Promise<T> {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // Бэкенд/прокси вернул не-JSON на успешный статус (пустое тело, HTML
      // от nginx) — приводим к стандартизированному ApiError, а не
      // пробрасываем голый SyntaxError мимо обработки ошибок.
      throw new ApiError("Invalid server response", "INVALID_RESPONSE", 502);
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      console.error("[ApiClient] Zod validation failed:", parsed.error);
      throw new ApiError("Invalid server response", "INVALID_RESPONSE", 502);
    }
    return parsed.data;
  }

  private async doFetch(endpoint: string, options: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    // Если сигнал вызывающего уже отменён ДО старта запроса, событие "abort"
    // больше не сработает — слушатель был бы no-op и запрос ушёл бы в сеть.
    // Пробрасываем отмену сразу.
    if (options.signal?.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      return await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut && error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Таймаут запроса", "REQUEST_TIMEOUT", 408);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  /**
   * Пытаемся обновить токен.
   * Используется паттерн «одного промиса», чтобы при нескольких
   * параллельных 401 refresh произошёл только один раз.
   */
  async tryRefresh(): Promise<RefreshResult> {
    // Паттерн «одного промиса»: при нескольких параллельных 401 refresh
    // произойдёт только один раз. Start/End уведомляем только у инициатора.
    const isNewRefresh = !this.refreshPromise;
    if (isNewRefresh) {
      this.refreshPromise = this.performRefresh();
      this.emitRefreshStart();
    }
    // Сразу после присваивания промис гарантированно не null.
    const promise = this.refreshPromise!;

    try {
      const result = await promise;
      if (isNewRefresh) {
        this.emitRefreshEnd(result);
      }
      return result;
    } finally {
      if (isNewRefresh) {
        this.refreshPromise = null;
      }
    }
  }

  private async performRefresh(): Promise<RefreshResult> {
    if (!this.refreshTokenValue) {
      return "permanent-rejection";
    }

    const generationAtStart = this.refreshGeneration;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: this.refreshTokenValue }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // 401 — refresh-токен отозван или истёк безвозвратно:
          // уведомляем подписчиков, чтобы сбросить сессию.
          if (response.status === 400 || response.status === 401 || response.status === 403) {
            // 403 с кодом FORBIDDEN = бан. Дополнительно уведомляем подписчиков
            // о бане с banReason из тела ответа, чтобы стор сразу показал плашку
            // без ожидания повторного bootstrap. Для 400/401 срабатывает только
            // обычный session-expired (сессия отозвана по другой причине).
            if (response.status === 403) {
              const errorBody = await response.json().catch(() => ({}));
              if (errorBody && errorBody.code === "FORBIDDEN") {
                this.emitBanned(readBanReason(errorBody));
                this.emitSessionExpired();
                return "permanent-rejection";
              }
            }
            this.emitSessionExpired();
            return "permanent-rejection";
          }
          return "transient-failure";
        }

        const parsed = authResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          console.error("[ApiClient] Invalid refresh response:", parsed.error);
          return "transient-failure";
        }
        const data = parsed.data;

        // Сессия была очищена, пока шёл запрос (invalidatePendingRefresh) —
        // не применяем токены и не воскрешаем сессию.
        if (this.refreshGeneration !== generationAtStart) {
          return "transient-failure";
        }

        this.token = data.accessToken;
        this.refreshTokenValue = data.refreshToken;

        // Уведомляем подписчиков (Zustand-стор), чтобы сессия не рассинхронизировалась.
        this.emitTokenUpdate({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn,
          user: data.user,
        });
        return "success";
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return "transient-failure";
    }
  }
}

interface ErrorRecord {
  message?: string;
  code?: string;
  retryAfterMs?: number;
}

function toErrorRecord(value: unknown): ErrorRecord {
  if (!value || typeof value !== "object") return {};
  const message = Reflect.get(value, "message");
  const code = Reflect.get(value, "code");
  const retryAfterMs = Reflect.get(value, "retryAfterMs");
  return {
    message: typeof message === "string" ? message : undefined,
    code: typeof code === "string" ? code : undefined,
    retryAfterMs: typeof retryAfterMs === "number" ? retryAfterMs : undefined,
  };
}

export const apiClient = new ApiClient();
