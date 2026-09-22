import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { completeOnboardingBodySchema } from "@edem/contracts";
import { db } from "../db.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import { serializeUser, serializePublicUser } from "../serializers/index.js";
import {
  publicReadLimiter,
  mutationLimiter,
  profileUpdateLimiter,
} from "../middleware/rateLimit.js";
import { getSanitizedBody } from "../middleware/sanitize.js";
import { wsManager } from "../ws/manager.js";
import { revokeAllActiveTokens } from "../auth/tokens.js";
import { ERROR_CODES } from "../errors.js";
import { DEFAULT_AVATAR_URL } from "../constants.js";

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  about: z.string().max(500).nullable().optional(),
});

const carFormSchema = z.object({
  model: z.string().min(1).max(50),
  color: z.string().min(1).max(30),
  // Номер — опционален (примета для узнавания машины, не госномер строго).
  // Пустая строка нормализуется в null в upsertCar, чтобы не хранить "".
  plate: z.string().max(15).optional(),
});

const updateNotificationSettingsSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
});

export const usersRouter = new Hono<AuthEnv>();

usersRouter.delete("/me", requireUser, mutationLimiter, async (c) => {
  const user = c.get("user");
  const now = new Date();
  const result = await db.$transaction(
    async (tx) => {
      const activeTrip = await tx.trip.findFirst({
        where: { driverId: user.id, status: "active" },
        select: { id: true },
      });
      const activeBooking = await tx.booking.findFirst({
        where: {
          passengerId: user.id,
          status: { in: ["pending", "confirmed"] },
          // Только активные поездки — завершённые/отменённые это история
          // и удалению не мешают (иначе история блокировала бы его навсегда).
          trip: { status: "active" },
        },
        select: { id: true },
      });
      if (activeTrip || activeBooking) return { kind: "obligations" as const };
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.feedback.deleteMany({ where: { userId: user.id } });
      await tx.rideRequest.updateMany({
        where: { userId: user.id, status: { in: ["active", "paused"] } },
        data: { status: "cancelled" },
      });
      await tx.car.deleteMany({ where: { userId: user.id } });
      // Keep the signed Telegram identity as a tombstone: clearing it would
      // allow the next Telegram login to create a second account for the
      // same person.
      await tx.user.update({
        where: { id: user.id },
        data: {
          deletedAt: now,
          name: "Удалённый пользователь",
          avatar: DEFAULT_AVATAR_URL,
          about: null,
          rating: 5,
          reviewsCount: 0,
          tripsCount: 0,
          onboardingVersion: null,
          // Согласие аннулируется вместе с аккаунтом (акцепт при следующем
          // входе после восстановления невозможен — вход для удалённого
          // терминален; поле обнуляется для чистоты обезличивания).
          consentAcceptedAt: null,
        },
      });
      return { kind: "deleted" as const };
    },
    { isolationLevel: "Serializable" },
  );
  if (result.kind === "obligations")
    return c.json(
      {
        code: ERROR_CODES.ACCOUNT_HAS_ACTIVE_OBLIGATIONS,
        message: "Resolve active trips and bookings first",
      },
      409,
    );
  wsManager.closeUserConnections(user.id, 4403, "Account deleted");
  await revokeAllActiveTokens(user.id);
  return c.json({ success: true });
});

/**
 * Текущий пользователь.
 */
usersRouter.get("/me", requireUser, async (c) => {
  const user = c.get("user");

  return c.json(serializeUser(user));
});

usersRouter.patch(
  "/me/notification-settings",
  requireUser,
  profileUpdateLimiter,
  async (c) => {
    const user = c.get("user");
    const body = await getSanitizedBody(c);
    const parseResult = updateNotificationSettingsSchema.safeParse(body);

    if (!parseResult.success) {
      return c.json({ message: "Invalid payload" }, 400);
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        notificationsEnabled:
          parseResult.data.notificationsEnabled ?? user.notificationsEnabled,
      },
      include: { car: true },
    });

    return c.json(serializeUser(updated));
  },
);

/**
 * Завершение онбординга: сохраняем версию показанных слайдов.
 * При обновлении набора слайдов клиент повышает версию и проходит
 * онбординг заново; админка может сбросить флаг в null
 * (PATCH /admin/users/:id/onboarding-reset) для повторного показа.
 *
 * С версии "2" этот же вызов — фиксация акцепта правовых документов
 * (ConsentGate «Принять»): проставляем consentAcceptedAt — момент
 * согласия (152-ФЗ ст. 9, доказуемость).
 */
usersRouter.post("/me/onboarding", requireUser, mutationLimiter, async (c) => {
  const user = c.get("user");
  const body = await getSanitizedBody(c);
  const parseResult = completeOnboardingBodySchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({ message: "Invalid payload" }, 400);
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      onboardingVersion: parseResult.data.version,
      consentAcceptedAt: new Date(),
    },
    include: { car: true },
  });

  return c.json(serializeUser(updated));
});

/**
 * Редактирование профиля текущего пользователя.
 */
usersRouter.patch("/me", requireUser, profileUpdateLimiter, async (c) => {
  const user = c.get("user");

  const body = await getSanitizedBody(c);
  const parseResult = updateProfileSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      { message: "Invalid payload", errors: z.formatError(parseResult.error) },
      400,
    );
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      name: parseResult.data.name ?? user.name,
      about:
        parseResult.data.about === undefined
          ? user.about
          : parseResult.data.about,
    },
    include: {
      car: true,
    },
  });

  return c.json(serializeUser(updated));
});

async function upsertCar(c: Context<AuthEnv>) {
  const user = c.get("user");

  const body = await getSanitizedBody(c);
  const parseResult = carFormSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      { message: "Invalid payload", errors: z.formatError(parseResult.error) },
      400,
    );
  }

  const { plate, ...rest } = parseResult.data;
  // Пустой/пробельный номер → null (поле опционально, "" не храним).
  const normalizedPlate = plate?.trim() ? plate.trim() : null;

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      car: {
        upsert: {
          create: { ...rest, plate: normalizedPlate },
          update: { ...rest, plate: normalizedPlate },
        },
      },
    },
    include: {
      car: true,
    },
  });

  return c.json(serializeUser(updated));
}

/**
 * Создать или обновить машину текущего пользователя.
 */
usersRouter.post("/me/car", requireUser, profileUpdateLimiter, upsertCar);

/**
 * Алиас для обновления машины.
 */
usersRouter.patch("/me/car", requireUser, profileUpdateLimiter, upsertCar);

/**
 * Удаление машины текущего пользователя.
 *
 * Инвариант trips-creation (trips/index.ts: создание поездки требует car,
 * иначе NO_CAR): водитель с активными поездками без машины — неконсистентное
 * состояние (карточки поездок показывают авто водителя). Поэтому при наличии
 * active-поездок удаление блокируется 409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS —
 * зеркально DELETE /users/me. Завершённые/отменённые поездки — история,
 * удалению не мешают. Брони пассажира машину не затрагивают (авто нужно
 * только водителю), их не проверяем.
 *
 * Account-safe identity: requireUser отклоняет 401 без токена и 403
 * забаненным/удалённым до handler'а; удаляется ТОЛЬКО car своего userId
 * (чужие данные недоступны по построению). Нет авто → 404 NOT_FOUND.
 * Возвращаем обновлённого пользователя (как upsertCar) — клиент синкает
 * кэш и стор одним ответом.
 */
usersRouter.delete("/me/car", requireUser, profileUpdateLimiter, async (c) => {
  const user = c.get("user");

  const activeTrip = await db.trip.findFirst({
    where: { driverId: user.id, status: "active" },
    select: { id: true },
  });
  if (activeTrip) {
    return c.json(
      {
        code: ERROR_CODES.ACCOUNT_HAS_ACTIVE_OBLIGATIONS,
        message: "Resolve active trips first",
      },
      409,
    );
  }

  const existing = await db.car.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Car not found" },
      404,
    );
  }

  await db.car.delete({ where: { userId: user.id } });

  const updated = await db.user.findUnique({
    where: { id: user.id },
    include: { car: true },
  });

  // requireUser только что вернул пользователя из БД — строка существует.
  if (!updated) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "User not found" },
      404,
    );
  }

  return c.json(serializeUser(updated));
});

/**
 * Публичный профиль пользователя.
 */
usersRouter.get("/:id", publicReadLimiter, async (c) => {
  const id = c.req.param("id");

  const user = await db.user.findUnique({
    where: { id },
    include: {
      car: true,
    },
  });

  if (!user) {
    return c.json({ message: "User not found" }, 404);
  }

  return c.json(serializePublicUser(user));
});
