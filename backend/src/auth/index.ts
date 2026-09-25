// backend/src/auth/index.ts
import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import { refreshRequestSchema, telegramAuthRequestSchema } from "@edem/contracts";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { ERROR_CODES } from "../errors.js";
import { DEFAULT_AVATAR_URL } from "../constants.js";
import { serializeUser } from "../serializers/index.js";

import { verifyTelegramInitData } from "./telegramSign.js";
import { resolveTelegramProfile } from "./telegramProfile.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  revokeAllActiveTokens,
  RefreshTokenRevokedError,
  TokenValidationError,
  hashToken,
  MOCK_REFRESH_TOKEN_PREFIX,
} from "./tokens.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { getSanitizedBody } from "../middleware/sanitize.js";

export const authRouter = new Hono();

const refreshLimiter = createRateLimiter({
  windowMs: env.REFRESH_RATE_WINDOW_MS,
  max: env.REFRESH_RATE_MAX,
  keyPrefix: "auth-refresh",
});

const tgAuthLimiter = createRateLimiter({
  windowMs: env.TG_AUTH_RATE_WINDOW_MS,
  max: env.TG_AUTH_RATE_MAX,
  keyPrefix: "auth-tg",
});

authRouter.post("/telegram", tgAuthLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parseResult = telegramAuthRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        message: "Invalid request payload",
        errors: z.formatError(parseResult.error),
      },
      400,
    );
  }

  const { initData } = parseResult.data;

  // Не сконфигурирован: токен бота не задан и dev-режим выключен.
  // Это не «невалидная подпись» (401), а выключенная фича (как пустой
  // ADMIN_TOKEN): клиенту не нужно ретраить и сбрасывать сессию.
  if (!env.TELEGRAM_BOT_TOKEN && !env.ALLOW_DEV_AUTH) {
    return c.json(
      { code: ERROR_CODES.INTERNAL_ERROR, message: "Telegram auth is not configured" },
      503,
    );
  }

  const result = verifyTelegramInitData(initData);

  if (!result.isValid || result.telegramUserId === undefined) {
    return c.json({ message: "Invalid or expired signature" }, 401);
  }

  const telegramUserId = result.telegramUserId;

  // Display-данные: user-объект подписан Telegram (часть initData), но
  // всё равно проходит санитизацию и host-allowlist аватара
  // (telegramProfile.ts — defense in depth).
  const { name: tgName, avatar: tgAvatar } = resolveTelegramProfile(result.user);
  const placeholderName = `Пользователь Telegram ${telegramUserId}`;

  // Каноника гонок: уникальный telegramUserId, upsert как
  // SELECT → INSERT (не ON CONFLICT) при пустом update → P2002 у второго
  // из двух конкурентных запусков; один ретрай решает.
  const upsertUser = () =>
    db.user.upsert({
      where: { telegramUserId },
      create: {
        telegramUserId,
        name: tgName ?? placeholderName,
        avatar: tgAvatar ?? DEFAULT_AVATAR_URL,
        rating: 5.0,
        reviewsCount: 0,
        tripsCount: 0,
        // Telegram-auth = верифицированный вход (подпись initData):
        // isVerified true без отдельной модерации.
        isVerified: true,
        verifiedAt: new Date(),
      },
      update: {
        // Аватар не редактируется через API — синхронизируем с актуальным
        // фото Telegram при входе. Tombstone удалённых не трогаем (ниже).
        ...(tgAvatar ? { avatar: tgAvatar } : {}),
      },
      include: { car: true },
    });

  // Tombstone удалённых хранит telegramUserId для блокировки повторного
  // входа: проверяем ДО upsert, чтобы отклонённый логин не мутировал запись.
  const tombstone = await db.user.findUnique({
    where: { telegramUserId },
    select: { id: true, deletedAt: true },
  });
  if (tombstone?.deletedAt) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Account is deleted" },
      403,
    );
  }

  let user;
  try {
    user = await upsertUser();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Гонка конкурентных запусков: другой запрос успел создать пользователя.
      user = await upsertUser();
    } else {
      throw error;
    }
  }

  // Placeholder-имена дописываем реальным именем Telegram; вручную
  // отредактированное (PATCH /users/me) не перезаписываем.
  const finalUser =
    tgName && user.name === placeholderName
      ? await db.user.update({
          where: { id: user.id },
          data: { name: tgName },
          include: { car: true },
        })
      : user;

  // Проверка бана ДО выпуска токенов — единая точка отказа обеих платформ.
  if (finalUser.bannedAt) {
    const revokedCount = await revokeAllActiveTokens(finalUser.id);
    logger.warn(
      { userId: finalUser.id, revokedCount },
      "[Auth] Telegram login rejected — user is banned",
    );
    return c.json(
      {
        code: ERROR_CODES.FORBIDDEN,
        message: "Account is banned",
        banReason: finalUser.banReason ?? null,
      },
      403,
    );
  }

  if (finalUser.deletedAt) {
    return c.json(
      { code: ERROR_CODES.FORBIDDEN, message: "Account is deleted" },
      403,
    );
  }

  const accessToken = await signAccessToken(finalUser.id);
  const refreshToken = await signRefreshToken(finalUser.id); // Создаёт запись в БД

  return c.json({
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    user: serializeUser(finalUser, { includePhone: true }),
  });
});

authRouter.post("/refresh", refreshLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parseResult = refreshRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({ message: "Invalid refresh token" }, 400);
  }

  try {
    const { userId, jti } = await verifyRefreshToken(
      parseResult.data.refreshToken,
    );

    // DEV mock refresh: записи в БД нет (jti "dev-jti"), ротация невозможна.
    // Возвращаем свежий mock-токен с НОВЫМ exp (TTL DEV_MOCK_TOKEN_TTL_SECONDS),
    // чтобы dev-сессия не умирала по истечении access-токена.
    if (
      env.ALLOW_DEV_AUTH &&
      parseResult.data.refreshToken.startsWith(MOCK_REFRESH_TOKEN_PREFIX)
    ) {
      const user = await db.user.findUnique({
        where: { id: userId },
        include: { car: true },
      });

      if (!user) {
        return c.json({ message: "User not found" }, 401);
      }

      // Единообразно с основной веткой: забаненному пользователю токены
      // не выдаём. Записи refresh-токена в БД нет (jti "dev-jti") —
      // отзываем только реальные токены, если они есть.
      if (user.deletedAt) {
        await revokeAllActiveTokens(user.id);
        return c.json(
          { code: ERROR_CODES.FORBIDDEN, message: "Account is deleted" },
          403,
        );
      }

      if (user.bannedAt) {
        await revokeAllActiveTokens(user.id);
        return c.json(
          {
            code: ERROR_CODES.FORBIDDEN,
            message: "Account is banned",
            banReason: user.banReason ?? null,
          },
          403,
        );
      }

      const accessToken = await signAccessToken(user.id);
      // Новый exp: mock refresh-токен несёт TTL (security-audit: mocks
      // с коротким TTL), бесконечно живой refresh больше не выдаётся.
      const refreshExp =
        Math.floor(Date.now() / 1000) + env.DEV_MOCK_TOKEN_TTL_SECONDS;

      return c.json({
        accessToken,
        refreshToken: `${MOCK_REFRESH_TOKEN_PREFIX}${userId}-${refreshExp}`,
        expiresIn: env.JWT_ACCESS_TTL_SECONDS,
        user: serializeUser(user, { includePhone: true }),
      });
    }

    // Проверка бана ДО ротации и выпуска токенов: забаненный пользователь
    // не должен получать новые токены. Все активные refresh-токены
    // отзываем, чтобы бан нельзя было обойти через другую сессию.
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { car: true },
    });

    if (!user) {
      return c.json({ message: "User not found" }, 401);
    }

    if (user.deletedAt) {
      await revokeAllActiveTokens(user.id);
      return c.json(
        { code: ERROR_CODES.FORBIDDEN, message: "Account is deleted" },
        403,
      );
    }

    if (user.bannedAt) {
      const revokedCount = await revokeAllActiveTokens(user.id);
      logger.warn(
        { userId: user.id, revokedCount },
        "[Auth] Refresh rejected — user is banned",
      );
      return c.json(
        {
          code: ERROR_CODES.FORBIDDEN,
          message: "Account is banned",
          banReason: user.banReason ?? null,
        },
        403,
      );
    }

    const newJti = await rotateRefreshToken(jti, userId); // Атомарно: отзыв старого + создание нового

    const accessToken = await signAccessToken(user.id);
    // Подписываем JWT с newJti без дублирования записи в БД
    const refreshToken = await signRefreshToken(user.id, newJti);

    return c.json({
      accessToken,
      refreshToken,
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      user: serializeUser(user, { includePhone: true }),
    });
  } catch (error) {
    // Reuse detection: предъявление уже отозванного (ротированного) токена —
    // признак кражи. Отзываем ВСЕ активные токены пользователя, чтобы
    // украденная цепочка не могла быть использована (OAuth 2.0 BCP).
    if (error instanceof RefreshTokenRevokedError) {
      // Отзыв в отдельном try/catch: сбой БД при отзыве не должен менять
      // ответ (всегда 401) и терять security-событие в логах.
      try {
        const revokedCount = await revokeAllActiveTokens(error.userId);
        logger.warn(
          { userId: error.userId, revokedCount },
          "[Auth] Refresh token reuse detected — all active tokens revoked",
        );
      } catch (revokeError) {
        logger.error(
          { userId: error.userId, err: revokeError },
          "[Auth] Refresh token reuse detected — failed to revoke active tokens",
        );
      }
      return c.json({ message: "Invalid refresh token" }, 401);
    }

    // Ошибки ВАЛИДАЦИИ токена (невалидный формат/подпись/TTL, отозванный
    // или уже ротированный токен) — вина клиента → 401.
    if (error instanceof TokenValidationError) {
      return c.json({ message: "Invalid refresh token" }, 401);
    }

    // Инфраструктурные сбои (Prisma/доступ к БД, подписание) НЕ обязаны
    // выглядеть как «невалидные креды»: пробрасываем в глобальный onError
    // (лог + Sentry + 500). Раньше catch-all превращал сбой БД в 401 —
    // клиенты сбрасывали валидные сессии, а мониторинг не видел инцидент.
    throw error;
  }
});

authRouter.post("/logout", refreshLimiter, async (c) => {
  const body = await getSanitizedBody(c);
  const parseResult = refreshRequestSchema.safeParse(body);

  if (parseResult.success) {
    try {
      // Предикат отзыва — (tokenHash, userId): та же привязка к владельцу,
      // что в verifyRefreshToken/rotateRefreshToken. Чужой jti ничего не трогает.
      const { jti, userId } = await verifyRefreshToken(
        parseResult.data.refreshToken,
      );
      await db.refreshToken.updateMany({
        where: { tokenHash: hashToken(jti), userId },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Игнорируем — логаут всегда успешен для клиента
    }
  }
  return c.json({ success: true });
});
