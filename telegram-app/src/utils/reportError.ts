/**
 * Репортёр клиентских ошибок → POST /api/v1/client-errors.
 *
 * - Дедупликация: минута на отпечаток, не более 50 записей.
 * - Транспорт: navigator.sendBeacon (как шлёт sendBeacon — text/plain),
 *   запасной путь — fetch с keepalive (страница может закрываться).
 * - Фильтр шума: ResizeObserver, Script error, расширения браузера,
 *   AbortError, ожидаемые ApiError 4xx (их уже обрабатывает UI).
 * - В dev — только log(), ничего не отправляется.
 * - initErrorReporting() вызывается в main.tsx ДО рендера, чтобы ловить
 *   сбои инициализации.
 */
import { ApiError } from "@/api/client.ts";
import { log } from "./log.ts";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
const ENDPOINT = `${API_BASE_URL}/client-errors`;

const DEDUPE_TTL_MS = 60_000;
const MAX_SEEN = 50;

export type ReportKind = "error" | "unhandledrejection" | "boundary";

export interface ReportExtra {
  kind?: ReportKind;
  componentStack?: string;
  route?: string;
}

const seen = new Map<string, number>();

function fingerprint(kind: string, message: string): string {
  return `${kind}:${message}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  // DOMException (AbortError от fetch) — не instanceof Error.
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error ?? "unknown error");
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** Шум, который не отправляем (иначе алерты станут неинформативными). */
export function isNoiseError(error: unknown): boolean {
  const message = errorMessage(error);
  if (!message || message === "Script error.") return true;
  if (message.includes("ResizeObserver loop")) return true;
  // Нестабильная сеть (мобильные клиенты): fetch в Safari/Firefox/Chrome.
  // Исключение: "Failed to fetch dynamically imported module" (устаревший
  // чанк после деплоя при React.lazy) — отправляем, иначе пропуск чанка
  // станет невидимым.
  if (message.includes("dynamically imported module")) return false;
  if (
    message.includes("Failed to fetch") ||
    message.includes("Load failed") ||
    message.includes("NetworkError") ||
    message.includes("Network request failed")
  ) {
    return true;
  }
  const stack = errorStack(error) ?? "";
  if (
    stack.includes("chrome-extension://") ||
    stack.includes("moz-extension://")
  ) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  ) {
    return true;
  }
  if (
    error instanceof ApiError &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return true;
  }
  return false;
}

function currentRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;
  // HashRouter: pathname всегда "/", реальный маршрут — в location.hash.
  const hash = window.location.hash.replace(/^#/, "");
  return hash || window.location.pathname;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function reportError(error: unknown, extra: ReportExtra = {}): void {
  if (isNoiseError(error)) return;

  const kind = extra.kind ?? "error";
  const message = errorMessage(error);
  const key = fingerprint(kind, message);
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_TTL_MS) return;
  seen.delete(key);
  if (seen.size >= MAX_SEEN) {
    const oldest = seen.keys().next();
    if (!oldest.done) seen.delete(oldest.value);
  }
  seen.set(key, now);

  const payload = JSON.stringify({
    kind,
    message: truncate(message, 500),
    stack: truncate(errorStack(error), 4000),
    componentStack: truncate(extra.componentStack, 1000),
    route: truncate(extra.route ?? currentRoute(), 200),
    release: truncate(
      typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
      40,
    ),
  });

  if (import.meta.env.DEV) {
    log("[reportError]", payload);
    return;
  }

  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(ENDPOINT, payload)
    ) {
      return;
    }
  } catch {
    // sendBeacon не должен ронять приложение — идём на fallback.
  }

  try {
    void fetch(ENDPOINT, {
      method: "POST",
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Fallback тоже best-effort.
  }
}

/** Слушатели error/unhandledrejection. Вызывать до рендера. */
export function initErrorReporting(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, { kind: "error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason ?? event, { kind: "unhandledrejection" });
  });
}
