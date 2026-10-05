// backend/src/auth/middleware.ts
import type { Context, Next } from "hono";
import type { Prisma } from "../generated/prisma/client.js";
import { db } from "../db.js";
import { verifyAccessToken } from "./tokens.js";
import { ACCOUNT_DELETED_MESSAGE, ERROR_CODES } from "../errors.js";

export type AuthUser = Prisma.UserGetPayload<{
  include: {
    car: true;
  };
}>;

export type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

export async function requireAuth(c: Context<AuthEnv>, next: Next) {
  const header =
    c.req.header("Authorization") ||
    c.req.header("authorization");

  if (!header) {
    return c.json({ code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" }, 401);
  }

  const parts = header.trim().split(/\s+/);

  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return c.json({ code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" }, 401);
  }

  const token = parts[1];

  let userId: string;
  try {
    userId = await verifyAccessToken(token);
  } catch {
    return c.json({ code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" }, 401);
  }

  // Запрос к БД вне try/catch: сбой БД — не ошибка авторизации,
  // пробрасываем в app.onError (500), а не маскируем под 401.
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { car: true },
  });

  if (!user) {
    return c.json({ code: ERROR_CODES.UNAUTHORIZED, message: "Unauthorized" }, 401);
  }

  if (user.deletedAt) {
    return c.json({ code: ERROR_CODES.ACCOUNT_DELETED, message: ACCOUNT_DELETED_MESSAGE }, 403);
  }

  if (user.bannedAt) {
    return c.json({ code: ERROR_CODES.FORBIDDEN, message: "Account is banned" }, 403);
  }

  c.set("user", user);

  return next();
}

export const requireUser = requireAuth;
