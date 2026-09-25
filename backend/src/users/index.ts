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
import { logBusinessEvent } from "../logger/business.js";
import { createNotification } from "../services/notification.service.js";

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  about: z.string().max(500).nullable().optional(),
  // Телефон (F1): E.164-ish после нормализации; "" → null (очистка).
  phone: z.string().max(25).nullable().optional(),
});

/**
 * Нормализация телефона: пробелы/дефисы/скобки-out, "" → null.
 * undefined = поле не прислали (оставить прежнее), false = невалидный
 * формат (вызывающий отвечает 400).
 */
function normalizePhone(
  value: string | null | undefined,
): string | null | false | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[\s\-()]/g, "");
  return /^\+?\d{7,15}$/.test(digits) ? digits : false;
}

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
  // Каскад вместо 409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS: удаление завершает
  // активные поездки водителя (forced complete — departure-гейт пропущен,
  // аккаунт исчезает и поездки нельзя оставить висеть) и отменяет
  // pending/confirmed брони пользователя на активных поездках.
  // Семантика — зеркало рантайма: complete (PATCH /trips/:id/complete)
  // отклоняет pending, оставляет confirmed историей, гасит места;
  // cancel брони (PATCH /bookings/:id/cancel) возвращает место в пул.
  const result = await db.$transaction(
    async (tx) => {
      const completedTrips: Array<{
        id: string;
        fromCity: string;
        toCity: string;
        confirmedPassengerIds: string[];
        declinedPassengerIds: string[];
      }> = [];
      const ownTrips = await tx.trip.findMany({
        where: { driverId: user.id, status: "active" },
        select: { id: true, fromCity: true, toCity: true },
      });
      for (const trip of ownTrips) {
        const pendings = await tx.booking.findMany({
          where: { tripId: trip.id, status: "pending" },
          select: { passengerId: true },
        });
        const confirmed = await tx.booking.findMany({
          where: { tripId: trip.id, status: "confirmed" },
          select: { passengerId: true },
        });
        await tx.booking.updateMany({
          where: { tripId: trip.id, status: "pending" },
          data: {
            status: "declined",
            cancelledAt: now,
            cancelledByType: "system",
            cancellationReason: "Trip completed (driver deleted account)",
          },
        });
        const declinedPassengerIds = Array.from(
          new Set(pendings.map((b) => b.passengerId)),
        );
        const confirmedPassengerIds = Array.from(
          new Set(confirmed.map((b) => b.passengerId)),
        );
        for (const passengerId of confirmedPassengerIds) {
          await tx.user.update({
            where: { id: passengerId },
            data: { tripsCount: { increment: 1 } },
          });
        }
        await tx.trip.update({
          where: { id: trip.id },
          data: { status: "completed", seatsAvailable: 0 },
        });
        completedTrips.push({
          id: trip.id,
          fromCity: trip.fromCity,
          toCity: trip.toCity,
          confirmedPassengerIds,
          declinedPassengerIds,
        });
      }

      // Свои брони — ПОСЛЕ завершения своих поездок: поездка уже completed
      // исключается фильтром trip.status active (самобронь на свою поездку
      // невозможна, но порядок страхует от двойной обработки).
      const ownBookings = await tx.booking.findMany({
        where: {
          passengerId: user.id,
          status: { in: ["pending", "confirmed"] },
          trip: { status: "active" },
        },
        select: {
          id: true,
          tripId: true,
          trip: {
            select: {
              driverId: true,
              seatsAvailable: true,
              seatsTotal: true,
            },
          },
        },
      });
      const cancelledBookings: Array<{ id: string; tripId: string; driverId: string }> = [];
      for (const booking of ownBookings) {
        await tx.trip.update({
          where: { id: booking.tripId },
          data: {
            seatsAvailable: Math.min(
              booking.trip.seatsAvailable + 1,
              booking.trip.seatsTotal,
            ),
          },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: "cancelled",
            cancelledAt: now,
            cancelledByType: "user",
            cancelledByUserId: user.id,
            cancellationReason: "Passenger deleted account",
          },
        });
        cancelledBookings.push({
          id: booking.id,
          tripId: booking.tripId,
          driverId: booking.trip.driverId,
        });
      }

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
      return { completedTrips, cancelledBookings };
    },
    { isolationLevel: "Serializable" },
  );

  // Уведомления + WS вне транзакции (паттерн complete/cancel рантайма).
  for (const trip of result.completedTrips) {
    logBusinessEvent("trip.completed", {
      tripId: trip.id,
      driverId: user.id,
      passengersCount: trip.confirmedPassengerIds.length,
    });
    for (const pid of trip.confirmedPassengerIds) {
      await createNotification(
        pid,
        "trip_status_changed",
        "Поездка завершена",
        `Поездка ${trip.fromCity} → ${trip.toCity} завершена. Вы можете оставить отзыв.`,
        "/bookings/history",
      );
      wsManager.sendToUser(pid, {
        type: "trip:status_changed",
        payload: { tripId: trip.id, status: "completed" },
      });
      wsManager.sendToUser(pid, {
        type: "notification:new",
        payload: { id: "refresh" },
      });
    }
    for (const pid of trip.declinedPassengerIds) {
      await createNotification(
        pid,
        "trip_status_changed",
        "Поездка завершена",
        `Поездка ${trip.fromCity} → ${trip.toCity} завершена, ваша заявка отклонена.`,
        "/bookings/history",
      );
      wsManager.sendToUser(pid, {
        type: "trip:status_changed",
        payload: { tripId: trip.id, status: "completed" },
      });
      wsManager.sendToUser(pid, {
        type: "notification:new",
        payload: { id: "refresh" },
      });
    }
  }
  for (const booking of result.cancelledBookings) {
    logBusinessEvent("booking.cancelled", {
      bookingId: booking.id,
      passengerId: user.id,
    });
    wsManager.sendToUser(booking.driverId, {
      type: "booking:status_changed",
      payload: { bookingId: booking.id, tripId: booking.tripId, status: "cancelled" },
    });
  }

  wsManager.closeUserConnections(user.id, 4403, "Account deleted");
  await revokeAllActiveTokens(user.id);
  return c.json({ success: true });
});

/**
 * Текущий пользователь.
 */
usersRouter.get("/me", requireUser, async (c) => {
  const user = c.get("user");

  return c.json(serializeUser(user, { includePhone: true }));
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

    return c.json(serializeUser(updated, { includePhone: true }));
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

  return c.json(serializeUser(updated, { includePhone: true }));
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

  const phone = normalizePhone(parseResult.data.phone);
  if (phone === false) {
    return c.json(
      { message: "Invalid phone format", errors: { phone: ["Invalid"] } },
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
      ...(phone === undefined ? {} : { phone }),
    },
    include: {
      car: true,
    },
  });

  return c.json(serializeUser(updated, { includePhone: true }));
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

  return c.json(serializeUser(updated, { includePhone: true }));
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
 * active-поездок удаление блокируется 409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS
 * (удаление аккаунта DELETE /users/me, наоборот, завершает поездки
 * каскадом). Завершённые/отменённые поездки — история,
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

  return c.json(serializeUser(updated, { includePhone: true }));
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
