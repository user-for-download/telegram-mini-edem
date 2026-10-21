// backend/src/auth/tokens.ts
import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import { randomUUID, createHash } from "node:crypto";
import { env, devUserAllowlist } from "../env.js";
import { logger } from "../logger.js";
import { db } from "../db.js";

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function signAccessToken(userId: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + env.JWT_ACCESS_TTL_SECONDS;

  return new SignJWT({
    type: "access",
    jti: randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(getJwtSecret());
}

/**
 * Подписывает refresh-токен.
 *
 * Если `existingJti` передан (ротация на /refresh) — запись в БД
 * уже создана внутри `rotateRefreshToken`, дублировать не нужно.
 * Иначе (первичный логин /telegram) — сохраняем хеш jti в RefreshToken.
 */
export async function signRefreshToken(
  userId: string,
  existingJti?: string
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + env.JWT_REFRESH_TTL_SECONDS;
  const jti = existingJti ?? randomUUID();

  const token = await new SignJWT({ type: "refresh", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(getJwtSecret());

  if (!existingJti) {
    await db.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(jti),
        expiresAt: new Date(exp * 1000),
      },
    });
  }

  return token;
}

// ─── Dev mock-токены (ALLOW_DEV_AUTH) ───────────────────────────────────────
// Формат: `mock-<access|refresh>-token-<userId>-<exp>` (exp — epoch seconds).
//
// Безопасность (security-audit, секция «Auth & session»):
//  - токен принимается ТОЛЬКО для пользователей из явного allowlist
//    (DEV_AUTH_USER_ALLOWLIST) — произвольный userId из строки токена
//    больше не имплицирует права;
//  - токен несёт срок действия: истёкший mock-токен → 401;
//  - срок жизни ограничен DEV_MOCK_TOKEN_TTL_SECONDS (защита от
//    сфабрикованного токена с exp «далеко в будущем»).
//  - mock-ветка активна только при ALLOW_DEV_AUTH: в production он
//    всегда false, поэтому эти проверки в prod не выполняются.

export const MOCK_ACCESS_TOKEN_PREFIX = "mock-access-token-";
export const MOCK_REFRESH_TOKEN_PREFIX = "mock-refresh-token-";

/** Допуск расхождения часов в проверке «TTL не превышен» (мс). */
const MOCK_CLOCK_SKEW_MS = 5_000;

export interface DevMockTokenClaims {
  userId: string;
  /** Момент истечения, epoch seconds. */
  exp: number;
}

/**
 * Разбирает dev mock-токен: префикс + userId + «-<exp epoch seconds>».
 *
 * exp — ПОСЛЕДНИЙ дефис-сегмент, ровно 10 цифр (epoch seconds ~2001–2286).
 * Ровно 10 цифр исключают ложное срабатывание на legacy-формат
 * `mock-access-token-<uuid>`: последний сегмент uuid — 16-ричные 12 символов,
 * и «попадание» в 10 цифр невозможно. Режем справа, т.к. user id — uuid
 * с дефисами. null при любом нарушении формата.
 */
export function parseDevMockToken(
  token: string,
  prefix: string
): DevMockTokenClaims | null {
  if (!token.startsWith(prefix)) return null;

  const rest = token.slice(prefix.length);
  const dashIdx = rest.lastIndexOf("-");
  if (dashIdx <= 0) return null;

  const userId = rest.slice(0, dashIdx);
  const expRaw = rest.slice(dashIdx + 1);
  if (!/^\d{10}$/.test(expRaw)) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= 0) return null;

  return { userId, exp };
}

/**
 * Проверяет TTL разобранных claims: не истёк и exp не далее
 * now + ttlMs (+ допуск расхождения часов). Бросает Error при нарушении —
 * вызывающий код трактует как 401.
 *
 * Чистая функция: время и TTL инжектятся (тестируемость без реальных часов).
 */
export function assertDevMockTokenFresh(
  claims: DevMockTokenClaims,
  nowMs: number,
  ttlMs: number
): void {
  const expMs = claims.exp * 1000;
  if (expMs <= nowMs) {
    throw new TokenValidationError("Mock token expired");
  }
  if (expMs > nowMs + ttlMs + MOCK_CLOCK_SKEW_MS) {
    throw new TokenValidationError("Mock token TTL exceeded");
  }
}

/** Пользователь из явного allowlist mock-токенов (dev/test)? */
export function isDevMockUserAllowed(userId: string): boolean {
  return devUserAllowlist().has(userId);
}

/**
 * Полная проверка dev mock-токена: формат → allowlist → TTL.
 * При любом нарушении бросает Error — вызывающий код трактует как 401.
 */
export function verifyDevMockToken(
  token: string,
  prefix: string,
  nowMs: number,
  ttlMs: number
): DevMockTokenClaims {
  const claims = parseDevMockToken(token, prefix);
  if (!claims) {
    throw new TokenValidationError("Invalid mock token format");
  }
  if (!isDevMockUserAllowed(claims.userId)) {
    throw new TokenValidationError("Mock token user not in allowlist");
  }
  assertDevMockTokenFresh(claims, nowMs, ttlMs);
  return claims;
}

export interface AccessTokenClaims {
  userId: string;
  expiresAt: number | undefined;
}

export async function verifyAccessTokenClaims(token: string): Promise<AccessTokenClaims> {
  // Support mock access tokens in test/development if ALLOW_DEV_AUTH is true.
  // Принимается только токен из явного allowlist с действующим TTL;
  // expiresAt теперь ВСЕГДА возвращается (в т.ч. WS-сессии знают,
  // когда закрывать соединение).
  if (env.ALLOW_DEV_AUTH && token.startsWith(MOCK_ACCESS_TOKEN_PREFIX)) {
    try {
      const claims = verifyDevMockToken(
        token,
        MOCK_ACCESS_TOKEN_PREFIX,
        Date.now(),
        env.DEV_MOCK_TOKEN_TTL_SECONDS * 1000
      );
      logger.warn(
        { env: env.NODE_ENV },
        "[Auth] DEV mock access token accepted"
      );
      return { userId: claims.userId, expiresAt: claims.exp * 1000 };
    } catch (error) {
      logger.warn(
        {
          env: env.NODE_ENV,
          reason: error instanceof Error ? error.message : "unknown",
        },
        "[Auth] DEV mock access token rejected"
      );
      throw error;
    }
  }

  const { payload } = await jwtVerify(token, getJwtSecret(), {
    algorithms: ["HS256"],
  });

  if (payload.type !== "access") {
    throw new Error("Invalid token type");
  }

  if (typeof payload.sub !== "string") {
    throw new Error("Invalid token subject");
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("Invalid token expiration");
  }

  return { userId: payload.sub, expiresAt: payload.exp * 1000 };
}

export async function verifyAccessToken(token: string): Promise<string> {
  const claims = await verifyAccessTokenClaims(token);
  return claims.userId;
}

// ─── Admin JWT ───────────────────────────────────────────────────────────────
// Отдельный тип токена для админ-панели: sub="admin", type="admin-access".
// В БД не хранится (нет refresh-семьи): доступ равен знанию ADMIN_TOKEN,
// отзыв через ротацию JWT_SECRET / истечение TTL.

export interface AdminTokenClaims {
  expiresAt: number;
  jti: string;
}

/**
 * Подписывает JWT админ-панели. Возвращает токен, момент истечения (epoch ms)
 * и jti — по нему создаётся серверная AdminSession.
 */
export async function signAdminAccessToken(): Promise<{
  token: string;
  expiresAt: number;
  jti: string;
}> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + env.ADMIN_JWT_TTL_SECONDS;
  const jti = randomUUID();

  const token = await new SignJWT({ type: "admin-access", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(getJwtSecret());

  return { token, expiresAt: exp * 1000, jti };
}

/**
 * Логин админки: подписывает JWT и создаёт серверную сессию.
 * Если запись в БД не создалась — логин падает, cookie не выставляется.
 */
export async function createAdminAccessSession(): Promise<{
  token: string;
  expiresAt: number;
}> {
  const { token, expiresAt, jti } = await signAdminAccessToken();

  await db.adminSession.create({
    data: {
      jti,
      // Привязка к текущему ADMIN_TOKEN: его ротация инвалидирует старые
      // сессии даже до истечения JWT.
      adminTokenHash: hashToken(env.ADMIN_TOKEN),
      expiresAt: new Date(expiresAt),
    },
  });

  return { token, expiresAt };
}

/**
 * Проверяет JWT и серверную сессию: токен должен быть не отозван, не истёк
 * и выпущен при текущем ADMIN_TOKEN.
 */
export async function verifyAdminSession(
  token: string,
): Promise<AdminTokenClaims> {
  const claims = await verifyAdminAccessToken(token);

  const session = await db.adminSession.findFirst({
    where: {
      jti: claims.jti,
      adminTokenHash: hashToken(env.ADMIN_TOKEN),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (!session) {
    throw new Error("Admin session revoked");
  }

  return claims;
}

/** Немедленный logout: отзывает конкретную сессию по jti. */
export async function revokeAdminSession(jti: string): Promise<void> {
  await db.adminSession.updateMany({
    where: { jti, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Отзывает сессию по cookie. Ошибки (битый/чужой JWT) проглатываются:
 * logout должен быть идемпотентным.
 */
export async function revokeAdminSessionByToken(token: string): Promise<void> {
  let claims: AdminTokenClaims;
  try {
    claims = await verifyAdminAccessToken(token);
  } catch {
    // Невалидный/чужой токен уже не даёт доступа — logout идемпотентен.
    return;
  }

  // Ошибку БД не проглатываем: иначе logout вернёт 200, а украденная
  // cookie останется валидной до exp. Пусть роут отдаст 500 и клиент
  // повторит.
  await revokeAdminSession(claims.jti);
}

/**
 * Проверяет JWT админ-панели: подпись, тип, subject, exp.
 * Бросает ошибку при любой невалидности — вызывающий код трактует как 401.
 */
export async function verifyAdminAccessToken(token: string): Promise<AdminTokenClaims> {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    algorithms: ["HS256"],
  });

  if (payload.type !== "admin-access") {
    throw new Error("Invalid token type");
  }

  if (payload.sub !== "admin") {
    throw new Error("Invalid token subject");
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("Invalid token expiration");
  }

  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    throw new Error("Invalid token jti");
  }

  return { expiresAt: payload.exp * 1000, jti: payload.jti };
}

/**
 * Ошибка: refresh-токен уже отозван (ротирован или logout).
 *
 * Обработчик сам решает реакцию: /refresh трактует как reuse и отзывает
 * всю семью токенов, /logout — игнорирует (повторный логаут безопасен).
 */
/**
 * Ошибка ВАЛИДАЦИИ токена — вина клиента (невалидный формат/подпись/TTL,
 * отозванный или уже ротированный токен). Вызывающий код трактует как 401.
 *
 * Отдельный класс нужен для узкой обработки в /auth/refresh: ошибки
 * инфраструктуры (Prisma, доступ к БД, подписание) НЕ являются
 * TokenValidationError и должны попадать в глобальный onError (500),
 * а не маскироваться под «Invalid refresh token» (401).
 */
export class TokenValidationError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "TokenValidationError";
  }
}

export class RefreshTokenRevokedError extends Error {
  constructor(public readonly userId: string) {
    super("Refresh token revoked");
    this.name = "RefreshTokenRevokedError";
  }
}

/**
 * Отзыв всех активных refresh-токенов пользователя (token family revocation).
 *
 * Вызывается при обнаружении повторного использования уже отозванного токена —
 * это признак кражи: обнуляем всю цепочку, чтобы украденные токены не могли
 * быть использованы.
 */
export async function revokeAllActiveTokens(userId: string): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Проверяет refresh-токен: подпись, наличие записи в БД,
 * отсутствие отзыва и срок действия. Возвращает userId и jti.
 *
 * Привязка к пользователю (security-audit «Auth & session»): запись ищется
 * по паре (tokenHash, userId из подписанного sub), а не по токену в одиночку.
 * Несовпадение userId даёт ту же обобщённую ошибку, что и отсутствие записи, —
 * без оракула и без отзыва чужой семьи токенов.
 *
 * Если токен уже отозван — бросает RefreshTokenRevokedError (с userId),
 * чтобы вызывающий код мог применить политику reuse-детекции.
 */
export async function verifyRefreshToken(
  token: string
): Promise<{ userId: string; jti: string }> {
  // DEV mock refresh: те же правила, что и для access — явный allowlist
  // и действующий TTL. jti фиксирован ("dev-jti"): записей в БД для
  // mock-токенов нет, ротация невозможна (см. ветку /refresh в auth/index.ts).
  if (env.ALLOW_DEV_AUTH && token.startsWith(MOCK_REFRESH_TOKEN_PREFIX)) {
    try {
      const claims = verifyDevMockToken(
        token,
        MOCK_REFRESH_TOKEN_PREFIX,
        Date.now(),
        env.DEV_MOCK_TOKEN_TTL_SECONDS * 1000
      );
      logger.warn(
        { env: env.NODE_ENV },
        "[Auth] DEV mock refresh token accepted"
      );
      return { userId: claims.userId, jti: "dev-jti" };
    } catch (error) {
      logger.warn(
        {
          env: env.NODE_ENV,
          reason: error instanceof Error ? error.message : "unknown",
        },
        "[Auth] DEV mock refresh token rejected"
      );
      throw error;
    }
  }

  // Подпись/формат JWT — вина клиента (битый токен, чужой секрет, истёкший
  // exp). JOSE-ошибки заворачиваем в TokenValidationError, чтобы /refresh
  // отличал их от инфраструктурных сбоев (Prisma/подписание) — иначе сбой БД
  // маскировался бы под 401 «Invalid refresh token».
  let payload: JWTPayload;
  try {
    payload = (
      await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] })
    ).payload;
  } catch (error) {
    throw new TokenValidationError("Invalid or expired token", {
      cause: error,
    });
  }

  if (payload.type !== "refresh") {
    throw new TokenValidationError("Invalid token type");
  }

  if (typeof payload.sub !== "string") {
    throw new TokenValidationError("Invalid token subject");
  }

  if (typeof payload.jti !== "string") {
    throw new TokenValidationError("Invalid token jti");
  }

  const tokenHash = hashToken(payload.jti);
  const dbToken = await db.refreshToken.findFirst({
    where: { tokenHash, userId: payload.sub },
  });

  if (!dbToken || dbToken.expiresAt < new Date()) {
    throw new TokenValidationError("Token revoked or expired");
  }

  if (dbToken.revokedAt) {
    throw new RefreshTokenRevokedError(dbToken.userId);
  }

  return { userId: payload.sub, jti: payload.jti };
}

/**
 * Атомарная ротация refresh-токена:
 * отзывает старый и создаёт новую запись в БД в одной транзакции.
 *
 * Предикат отзыва — (tokenHash, userId, revokedAt IS NULL): чужой jti
 * (или перепутанный вызов с чужим userId) даёт count === 0 — ничего
 * не отзывается и новый токен не выпускается.
 *
 * Отзыв выполняется одним UPDATE c предикатом `revokedAt IS NULL`. Под Read
 * Committed конкурирующий UPDATE после ожидания блокировки строки перечитывает
 * её свежую версию (EvalPlanQual) и видит `revokedAt` — поэтому из двух
 * параллельных ротаций одного токена ровно одна получит count === 1, а вторая
 * count === 0 и бросит RefreshTokenRevokedError (reuse). Двойная выдача
 * невозможна.
 */
export async function rotateRefreshToken(
  oldJti: string,
  userId: string
): Promise<string> {
  const oldHash = hashToken(oldJti);

  return db.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: { tokenHash: oldHash, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count !== 1) {
      // Конкурентная ротация уже использовала этот токен. Это не просто
      // «плохой токен», а признак повторного предъявления: отдаём
      // RefreshTokenRevokedError, чтобы /auth/refresh отозвал всю семью.
      // Иначе победитель гонки оставлял бы активный токен у атакующего.
      throw new RefreshTokenRevokedError(userId);
    }

    const newJti = randomUUID();
    const exp = Math.floor(Date.now() / 1000) + env.JWT_REFRESH_TTL_SECONDS;

    await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(newJti),
        expiresAt: new Date(exp * 1000),
      },
    });

    return newJti;
  });
}
