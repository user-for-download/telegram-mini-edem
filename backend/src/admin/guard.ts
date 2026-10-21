// backend/src/admin/guard.ts
// Доступ к админ-API: JWT из httpOnly cookie edem_admin_jwt.
// JWT выдаётся на POST /api/v1/admin/auth/login после проверки ADMIN_TOKEN.
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { env } from "../env.js";
import { ERROR_CODES } from "../errors.js";
import { verifyAdminSession } from "../auth/tokens.js";

export const ADMIN_COOKIE_NAME = "edem_admin_jwt";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;

function isAllowedAdminOrigin(
  origin: string,
  host: string | undefined,
): boolean {
  if (origin === "null") return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (host && parsed.host === host) return true;

  return env.CORS_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(parsed.origin);
}

/**
 * CSRF-guard для админских мутаций.
 *
 * Cookie-аутентификация автоматически уходит с cross-site запросами,
 * поэтому одной httpOnly cookie мало. Проверяем:
 *  - Sec-Fetch-Site (если браузер прислал): только same-origin;
 *  - Origin (если прислан): совпадает с Host или allowlist CORS_ORIGINS;
 *  - Content-Type: form/text/plain не принимаем — только JSON или пустое тело.
 *
 * Запросы без Origin/Sec-Fetch-Site (curl, server-to-server) не ломаем:
 * cross-site браузерная форма всегда несёт Origin и/или form content-type.
 */
export const adminCsrfGuard: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    return next();
  }

  const secFetchSite = c.req.header("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin") {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Cross-site request rejected" },
      403,
    );
  }

  // Sec-Fetch-Site — браузерный forbidden header, подделать из JS нельзя.
  // same-origin уже доказывает, что запрос не CSRF; Origin при этом может
  // не совпасть с Host из-за dev-прокси (Vite changeOrigin) или внешнего
  // reverse proxy, поэтому для такого запроса Origin-allowlist не нужен.
  const sameOriginFetch = secFetchSite === "same-origin";
  const origin = c.req.header("origin");
  if (
    origin &&
    !sameOriginFetch &&
    !isAllowedAdminOrigin(origin, c.req.header("host"))
  ) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Cross-site request rejected" },
      403,
    );
  }

  const contentType = c.req.header("content-type");
  if (contentType && !JSON_CONTENT_TYPE.test(contentType)) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "JSON content-type required" },
      403,
    );
  }

  await next();
};

/**
 * Guard для /api/v1/admin.
 *
 * Закрыто по умолчанию: если ADMIN_TOKEN не задан (пустая строка),
 * ВСЕ запросы отклоняются с 403 в любой среде (включая development) —
 * логин в таком состоянии тоже невозможен.
 *
 * Отсутствие/невалидность cookie — 401 Unauthorized (нет сессии).
 */
export const adminGuard: MiddlewareHandler = async (c, next) => {
  if (!env.ADMIN_TOKEN) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Admin access disabled" },
      403
    );
  }

  const token = getCookie(c, ADMIN_COOKIE_NAME);
  if (!token) {
    return c.json(
      { code: ERROR_CODES.UNAUTHORIZED, message: "Admin session required" },
      401
    );
  }

  try {
    await verifyAdminSession(token);
  } catch {
    return c.json(
      { code: ERROR_CODES.UNAUTHORIZED, message: "Invalid or expired admin session" },
      401
    );
  }

  await next();
};
