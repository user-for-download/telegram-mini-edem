import type { ZodType } from "zod";
import { authResponseSchema, type AuthResponse } from "@edem/contracts";
import { MiniEmitter } from "./emitter";

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
type DeletedListener = () => void;

type ApiClientEvents = {
  tokenUpdate: [tokens: TokenUpdate];
  sessionExpired: [];
  banned: [banReason: string | null];
  deleted: [];
  refreshStart: [];
  refreshEnd: [result: RefreshResult];
};

/**
 * 403 удалённого аккаунта. Машинный код, по которому клиент отличает
 * удаление от бана: раньше делился код `FORBIDDEN`, и различать приходилось
 * ТОЛЬКО по тексту — переформулируй бэк «Account is deleted», и удалённый
 * аккаунт молча уезжал на плашку бана с предложением обжалования (при
 * удалении восстановление невозможно). Проверять удаление ДО бана.
 *
 * Соответствует `backend/src/errors.ts::ERROR_CODES.ACCOUNT_DELETED`.
 *
 * Константы ЖИВУТ ЗДЕСЬ — это единственный модуль приложения, который знает
 * протокол ошибки бэкенда. Стор, bookingErrors, ProfilePage, VehicleModal
 * импортируют `isAccountDeletedError` отсюда: копии сравнения в шести
 * местах разъезжались (две из них забыли константу — экран уезжал в «бан»).
 */
export const ACCOUNT_DELETED_CODE = "ACCOUNT_DELETED";

/**
 * Текст 403 удалённого аккаунта. Оставлен как ФОЛБЭК для старого бэка,
 * который ещё не отдаёт `ACCOUNT_DELETED`: новый клиент должен понимать и
 * тот, и тот ответ. Копировать эту строку в прикладной код нельзя — бери
 * `isAccountDeletedError`.
 */
export const ACCOUNT_DELETED_MESSAGE = "Account is deleted";

/**
 * Причины терминального закрытия WebSocket (код 4403). Тоже протокол
 * бэкенда, но НЕ код ошибки: у WS close-кадра нет структурированного поля,
 * поэтому бэк по-прежнему пишет строкой — и у удаления их ДВЕ (ws-auth и
 * самоудаление, различаются на «is»).
 *
 * Первое значение — та же строка, что ACCOUNT_DELETED_MESSAGE: один текст на
 * два канала, и здесь это зафиксировано ссылкой, а не совпадением.
 */
export const WS_TERMINAL_REASON = {
  /** ws-auth, deletedAt — backend/src/ws/index.ts:130 */
  deletedByWsAuth: ACCOUNT_DELETED_MESSAGE,
  /** DELETE /me, самоудаление — backend/src/users/index.ts:278, без «is» */
  deletedBySelf: "Account deleted",
  /** бан — backend/src/ws/index.ts:136 и backend/src/admin/index.ts:646 */
  banned: "Account is banned",
} as const;

/**
 * Единственное место, где приложение решает, что ошибка — удалённый
 * аккаунт, а не бан.
 *
 * Принимает и `ApiError`, и сырое тело ответа: в ветке refresh сначала
 * приходит `unknown`-объект, а не готовый `ApiError`. Статус 403 проверяют
 * вызывающие — предикат отвечает только за различение удаления и бана.
 */
export function isAccountDeletedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // Голый Error — не протокольный ответ: у него есть .message, но нет .code
  // и .status, и такой текст мог прийти откуда угодно. Без этой проверки
  // любая ошибка с текстом «Account is deleted» выдавала бы себя за удалённый
  // аккаунт. ApiError — потомок Error, поэтому проверяем именно «не наш».
  if (error instanceof Error && !(error instanceof ApiError)) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === ACCOUNT_DELETED_CODE || message === ACCOUNT_DELETED_MESSAGE;
}

export class ApiClient {
  private token: string | null = null;
  private refreshTokenValue: string | null = null;
  private refreshPromise: Promise<RefreshResult> | null = null;
  private refreshGeneration = 0;
  private emitter = new MiniEmitter<ApiClientEvents>("ApiClient");

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
    return this.emitter.on("tokenUpdate", listener);
  }

  private emitTokenUpdate(tokens: TokenUpdate) {
    this.emitter.emit("tokenUpdate", tokens);
  }

  /**
   * Подписка на необратимый отказ refresh (401 от /auth/refresh):
   * токен отозван/истёк, сессию нужно сбросить, иначе приложение
   * навсегда застревает с мёртвыми токенами.
   */
  onSessionExpired(listener: () => void): () => void {
    return this.emitter.on("sessionExpired", listener);
  }

  private emitSessionExpired() {
    this.emitter.emit("sessionExpired");
  }

  /**
   * Подписка на обнаружение бана при refresh (403 + код FORBIDDEN от
   * /auth/refresh). Стор обновляет status="banned" + banReason сразу,
   * без ожидания повторного bootstrap.
   */
  onBanned(listener: BannedListener): () => void {
    return this.emitter.on("banned", listener);
  }

  private emitBanned(banReason: string | null) {
    this.emitter.emit("banned", banReason);
  }

  /**
   * Подписка на обнаружение УДАЛЁННОГО аккаунта при refresh (403 +
   * FORBIDDEN + "Account is deleted" от /auth/refresh — тот же ответ, что
   * isDeletedError в bootstrap). Без этого удалённый аккаунт уходил на
   * плашку бана через emitBanned ниже.
   */
  onDeleted(listener: DeletedListener): () => void {
    return this.emitter.on("deleted", listener);
  }

  private emitDeleted() {
    this.emitter.emit("deleted");
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
    return this.emitter.on("refreshStart", listener);
  }

  /**
   * Подписка на завершение refresh (успешного или нет).
   * Вызывается ОДИН раз на refresh — только у инициатора.
   */
  onRefreshEnd(listener: (result: RefreshResult) => void): () => void {
    return this.emitter.on("refreshEnd", listener);
  }

  private emitRefreshStart(): void {
    this.emitter.emit("refreshStart");
  }

  private emitRefreshEnd(result: RefreshResult): void {
    this.emitter.emit("refreshEnd", result);
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
    // Сливаем через Headers: принимает plain-объект, массив пар и сам
    // Headers (спред `...headers` у Headers-объекта давал бы `{}` —
    // заголовки вызывающего молча терялись).
    const headers = new Headers({ "Content-Type": "application/json" });
    new Headers(options.headers).forEach((value, key) => {
      headers.set(key, value);
    });

    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
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
              const record = toErrorRecord(errorBody);
              // Удаление проверяем ДО бана и НЕЗАВИСИМО от кода FORBIDDEN:
              // раньше удаление делило этот код с баном, поэтому проверка
              // стояла внутри «code === FORBIDDEN». Теперь у удаления свой код
              // ACCOUNT_DELETED, и внешняя проверка проглотила бы его молча —
              // удалённый аккаунт получил бы обычный session-expired вместо
              // emitDeleted и уехал на экран логина.
              if (isAccountDeletedError(record)) {
                this.emitDeleted();
                this.emitSessionExpired();
                return "permanent-rejection";
              }
              // 403 с кодом FORBIDDEN = бан. Дополнительно уведомляем
              // подписчиков о бане с banReason из тела ответа, чтобы стор
              // сразу показал плашку без ожидания повторного bootstrap.
              if (record.code === "FORBIDDEN") {
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
