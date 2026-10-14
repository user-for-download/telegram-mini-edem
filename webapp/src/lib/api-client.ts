import { z, type ZodType } from "zod";

const API_BASE_PATH = "/api/v1/admin";

/**
 * Типизированная ошибка API: HTTP-статус + код ошибки бэкенда
 * (backend/src/errors.ts: VALIDATION_FAILED, FORBIDDEN, NOT_FOUND, ...).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function apiGet<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
  return request<T>(path, "GET", undefined, schema, signal);
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
  signal?: AbortSignal
): Promise<T> {
  return request<T>(path, "POST", body, schema, signal);
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
  signal?: AbortSignal
): Promise<T> {
  return request<T>(path, "PATCH", body, schema, signal);
}

export function apiPut<T>(
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
  signal?: AbortSignal
): Promise<T> {
  return request<T>(path, "PUT", body, schema, signal);
}

export function apiDelete<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
  return request<T>(path, "DELETE", undefined, schema, signal);
}

/**
 * Сессия админки живёт в httpOnly cookie — заголовки авторизации не нужны,
 * браузер сам прикрепляет cookie (same-origin через vite/proxy).
 *
 * 401 = сессия истекла/отсутствует: редиректим на /login. Исключение —
 * сам /auth/login (неверный токен показываем формой) и /auth/session
 * (всегда 200 по контракту).
 */
async function request<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  body: unknown,
  schema: ZodType<T> | undefined,
  signal?: AbortSignal
): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_PATH}${path}`, {
    method,
    headers,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      redirectToLogin();
    }
    throw await toApiError(response);
  }

  return parseJson(response, schema);
}

function redirectToLogin(): void {
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

/**
 * Парсинг JSON-тела. Пустое тело (204 No Content) считаем undefined.
 */
async function parseJson<T>(response: Response, schema?: ZodType<T>): Promise<T> {
  const text = await response.text();
  if (text === "") {
    if (schema === undefined) return undefined as T;
    throw new ApiError(response.status, "INVALID_RESPONSE", "Ответ сервера пуст");
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", "Ответ сервера содержит некорректный JSON");
  }
  if (schema === undefined) return data as T;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(502, "INVALID_RESPONSE", "Ответ сервера не соответствует контракту");
  }
  return parsed.data;
}

/**
 * Бэкенд возвращает ошибки плоским объектом { code, message, errors? }
 * (backend/src/errors.ts). Если тело не JSON или другой формы —
 * фолбэк на INTERNAL_ERROR.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const fallback = new ApiError(
    response.status,
    "INTERNAL_ERROR",
    `Request failed with status ${response.status}`
  );

  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body !== "object" || body === null) {
    return fallback;
  }

  const record = z.object({ code: z.unknown().optional(), message: z.unknown().optional() }).safeParse(body);
  if (!record.success) return fallback;
  const message =
    typeof record.data.message === "string" && record.data.message !== ""
      ? record.data.message
      : fallback.message;
  const code =
    typeof record.data.code === "string" && record.data.code !== ""
      ? record.data.code
      : fallback.code;

  return new ApiError(response.status, code, message);
}
