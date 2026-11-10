import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingSchema, paginatedReviewsResponseSchema, tripSchema, userSchema } from "@edem/contracts";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { DEFAULT_AVATAR_URL } from "../../src/constants.js";
import { ACCOUNT_DELETED_MESSAGE, ERROR_CODES } from "../../src/errors.js";
import * as sanitizer from "../../src/middleware/sanitize.js";
import { serializeBooking, serializeTrip, serializeUser } from "../../src/serializers/index.js";
import { devMockAccessToken, registerDevTelegramUser } from "../dev-mock-auth.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5_000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pause after real auth/sanitization, before the handler's live-state check. */
function pauseBody() {
  const admitted = deferred();
  const resume = deferred();
  const original = sanitizer.getSanitizedBody;
  const spy = vi.spyOn(sanitizer, "getSanitizedBody").mockImplementationOnce(async (c) => {
    const body = await original(c);
    admitted.resolve();
    await within(resume.promise, "request release");
    return body;
  });
  return {
    wait: () => within(admitted.promise, "request admission"),
    release: resume.resolve,
    restore: () => spy.mockRestore(),
  };
}

describe("DELETE /api/v1/users/me", () => {
  let userId: string;
  let driverId: string;
  let tripId: string;

  beforeEach(async () => {
    const suffix = Date.now() + Math.floor(Math.random() * 1000);
    const [user, driver] = await Promise.all([
      db.user.create({ data: { name: `Delete user ${suffix}`, telegramUserId: BigInt(6100000 + (suffix % 100000)), avatar: "", about: "about", phone: "+79991112233", tgChatJoinedAt: new Date() } }),
      db.user.create({ data: { name: `Delete driver ${suffix}`, telegramUserId: BigInt(6200000 + (suffix % 100000)), avatar: "" } }),
    ]);
    userId = user.id;
    driverId = driver.id;
    const trip = await db.trip.create({ data: { driverId, fromCity: "Москва", fromAddress: "A", toCity: "Тула", toAddress: "B", departureAt: new Date("2030-01-01T10:00:00Z"), durationMinutes: 120, distanceKm: 180, price: 700, seatsTotal: 3, seatsAvailable: 3, tags: [] } });
    tripId = trip.id;
    await db.car.create({ data: { userId, model: "Test", color: "Black", plate: "A000AA" } });
  });

  afterEach(async () => {
    if (userId) {
      await db.review.deleteMany({ where: { authorId: userId } });
    }
    await db.booking.deleteMany({ where: { passengerId: userId } });
    await db.rideRequest.deleteMany({ where: { userId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.car.deleteMany({ where: { userId: { in: [userId, driverId] } } });
    await db.user.deleteMany({ where: { id: { in: [userId, driverId] } } });
  });

  it("anonymizes the account and invalidates required auth", async () => {
    await db.userBlock.createMany({
      data: [
        { blockerId: userId, blockedId: driverId },
        { blockerId: driverId, blockedId: userId },
      ],
    });
    const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
    expect(response.status).toBe(200);
    const deleted = await db.user.findUnique({ where: { id: userId }, include: { car: true } });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.telegramUserId).not.toBeNull();
    expect(deleted?.name).toBe("Удалённый пользователь");
    expect(deleted?.phone).toBeNull();
    expect(deleted?.tgChatJoinedAt).toBeNull();
    expect(deleted?.car).toBeNull();
    expect(
      await db.userBlock.count({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      }),
    ).toBe(0);
    const after = await app.request("/api/v1/users/me", { headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
    expect(after.status).toBe(403);
  });

  it.each([
    { path: "/api/v1/users/me", payload: { phone: "+7 (900) 123-45-67" } },
    { path: "/api/v1/users/me/notification-settings", payload: { notificationsEnabled: false } },
  ])("rejects admitted PATCH $path after real deletion commits without restoring fields", async ({ path, payload }) => {
    await db.user.update({
      where: { id: userId },
      data: {
        name: "Private original name", avatar: "https://t.me/i/userpic/320/original.svg",
        about: "Private original about", onboardingVersion: "1",
        consentAcceptedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const token = devMockAccessToken(userId);
    const gate = pauseBody();
    const pending = Promise.resolve(app.request(path, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));
    try {
      await gate.wait();
      const deletion = await app.request("/api/v1/users/me", {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      expect(deletion.status).toBe(200);
      const deleted = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { car: true } });
      expect(deleted).toMatchObject({
        deletedAt: expect.any(Date), name: "Удалённый пользователь", avatar: DEFAULT_AVATAR_URL,
        about: null, phone: null, tgChatJoinedAt: null, car: null,
        onboardingVersion: null, consentAcceptedAt: null, notificationsEnabled: true,
      });

      gate.release();
      const res = await pending;
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        code: ERROR_CODES.ACCOUNT_DELETED, message: ACCOUNT_DELETED_MESSAGE,
      });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId }, include: { car: true } })).toEqual(deleted);
    } finally {
      gate.release();
      await Promise.allSettled([pending]);
      gate.restore();
    }
  });

  it("rolls back an overlapping phone-only profile transaction when deletion wins", async () => {
    await db.user.update({
      where: { id: userId },
      data: {
        avatar: "https://t.me/i/userpic/320/original.svg", onboardingVersion: "1",
        consentAcceptedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const token = devMockAccessToken(userId);
    const admitted = deferred();
    const resume = deferred();
    const original = db.$transaction.bind(db);
    const transaction = vi.spyOn(db, "$transaction").mockImplementationOnce(
      <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Parameters<typeof db.$transaction>[1]): Promise<T> =>
        original(async (tx) => {
          // Establish a real live snapshot, then execute the route's unchanged callback.
          await tx.user.findUniqueOrThrow({ where: { id: userId } });
          admitted.resolve();
          await within(resume.promise, "profile transaction release");
          return run(tx);
        }, { ...options, timeout: 15_000 }),
    );
    const pending = Promise.resolve(app.request("/api/v1/users/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+79001234567" }),
    }));
    try {
      await within(admitted.promise, "profile transaction snapshot");
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
      const deletion = await app.request("/api/v1/users/me", {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      expect(deletion.status).toBe(200);
      const deleted = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { car: true } });

      resume.resolve();
      const res = await pending;
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: ERROR_CODES.CONFLICT, message: "Concurrent update conflict, please retry", retryable: true,
      });
      expect(deleted).toMatchObject({
        deletedAt: expect.any(Date), name: "Удалённый пользователь", avatar: DEFAULT_AVATAR_URL,
        about: null, phone: null, tgChatJoinedAt: null, car: null,
        onboardingVersion: null, consentAcceptedAt: null,
      });
      expect(await db.user.findUniqueOrThrow({ where: { id: userId }, include: { car: true } })).toEqual(deleted);
    } finally {
      resume.resolve();
      await Promise.allSettled([pending]);
      transaction.mockRestore();
    }
  });

  it("masks stale deleted-author PII in the real public review response, preserving live output", async () => {
    const original = await db.user.update({
      where: { id: userId },
      data: { name: "Retained review author", avatar: "https://t.me/i/userpic/320/retained.svg" },
    });
    const review = await db.review.create({
      data: {
        authorId: userId, targetUserId: driverId, tripId, targetRole: "driver",
        rating: 5, text: "Public review", tripRoute: "Москва → Тула", status: "published",
      },
    });
    const liveResponse = await app.request(`/api/v1/reviews/user/${driverId}`);
    expect(liveResponse.status).toBe(200);
    const live = paginatedReviewsResponseSchema.parse(await liveResponse.json());
    expect(live.items).toHaveLength(1);
    expect(live.items[0].author).toMatchObject({ id: userId, name: original.name, avatar: original.avatar });

    // Deliberately retain PII/car to test projection defense independently of deletion storage cleanup.
    const deleted = await db.user.update({
      where: { id: userId }, data: { deletedAt: new Date() }, include: { car: true },
    });
    expect(deleted).toMatchObject({
      name: original.name, avatar: original.avatar, about: "about", phone: "+79991112233",
      car: { model: "Test", color: "Black", plate: "A000AA" },
    });
    const response = await app.request(`/api/v1/reviews/user/${driverId}`);
    expect(response.status).toBe(200);
    const page = paginatedReviewsResponseSchema.parse(await response.json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(review.id);
    expect(page.items[0].author).toEqual({
      id: userId, name: "Удалённый пользователь", avatar: DEFAULT_AVATAR_URL,
      rating: original.rating, reviewsCount: original.reviewsCount, tripsCount: original.tripsCount,
    });
  });

  it("omits stale deleted cars/PII from nested serializers even with private opt-ins", async () => {
    await db.user.update({
      where: { id: driverId },
      data: { avatar: "https://t.me/i/userpic/320/driver.svg", phone: "+79000000002", about: "Driver about" },
    });
    await db.car.create({ data: { userId: driverId, model: "Driver car", color: "White", plate: "B111BB" } });
    const include = {
      passenger: { include: { car: true } },
      trip: { include: { driver: { include: { car: true } } } },
    } satisfies Prisma.BookingInclude;
    const booking = await db.booking.create({
      data: { tripId, passengerId: userId, seat: 1, status: "confirmed" }, include,
    });
    const publicPassenger = userSchema.parse(serializeUser(booking.passenger));
    expect(publicPassenger.avatar).toBe(DEFAULT_AVATAR_URL);
    expect(publicPassenger.car).toEqual({ model: "Test", color: "Black" });
    expect(publicPassenger.phone).toBeUndefined();
    const ownPassenger = userSchema.parse(serializeUser(booking.passenger, { includePhone: true, includePlate: true }));
    expect(ownPassenger.car).toEqual({ model: "Test", color: "Black", plate: "A000AA" });
    expect(ownPassenger.phone).toBe("+79991112233");
    const publicDriver = userSchema.parse(serializeTrip(booking.trip).driver);
    expect(publicDriver.car).toEqual({ model: "Driver car", color: "White" });
    expect(publicDriver.phone).toBeUndefined();
    const privateDriver = tripSchema.parse(serializeTrip(booking.trip, { includePlate: true, includeDriverPhone: true })).driver;
    expect(privateDriver.car?.plate).toBe("B111BB");
    expect(privateDriver.phone).toBe("+79000000002");
    const liveBooking = bookingSchema.parse(serializeBooking(booking));
    expect(liveBooking.passenger.car?.plate).toBeUndefined();
    expect(liveBooking.trip.driver.car?.plate).toBe("B111BB");

    await db.user.updateMany({ where: { id: { in: [userId, driverId] } }, data: { deletedAt: new Date() } });
    const deleted = await db.booking.findUniqueOrThrow({ where: { id: booking.id }, include });
    expect(deleted.passenger).toMatchObject({
      name: booking.passenger.name, phone: booking.passenger.phone, car: { plate: "A000AA" },
    });
    expect(deleted.trip.driver).toMatchObject({
      name: booking.trip.driver.name, avatar: booking.trip.driver.avatar, phone: "+79000000002", car: { plate: "B111BB" },
    });
    const ownDeleted = serializeUser(deleted.passenger, { includePhone: true, includePlate: true });
    const nested = bookingSchema.parse(serializeBooking(deleted));
    const privateTrip = tripSchema.parse(serializeTrip(deleted.trip, { includePlate: true, includeDriverPhone: true }));
    for (const masked of [ownDeleted, nested.passenger, nested.trip.driver, privateTrip.driver]) {
      expect(masked).toMatchObject({ name: "Удалённый пользователь", avatar: DEFAULT_AVATAR_URL });
      expect(masked).not.toHaveProperty("car");
      expect(masked.phone).toBeUndefined();
      expect(masked.about).toBeUndefined();
    }
  });

  it("completes own active trips on deletion (pending declined, confirmed kept)", async () => {
    const ownTrip = await db.trip.create({ data: { driverId: userId, fromCity: "Москва", fromAddress: "A", toCity: "Тула", toAddress: "B", departureAt: new Date("2030-01-01T10:00:00Z"), durationMinutes: 120, distanceKm: 180, price: 700, seatsTotal: 3, seatsAvailable: 1, tags: [] } });
    const suffix = Date.now() + Math.floor(Math.random() * 1000);
    // active_passenger_booking: одна активная бронь на связку
    // (поездка, пассажир) — pending и confirmed у разных пассажиров.
    const [paxPending, paxConfirmed] = await Promise.all([
      db.user.create({ data: { name: `PaxP ${suffix}`, telegramUserId: BigInt(6300000 + (suffix % 100000)), avatar: "" } }),
      db.user.create({ data: { name: `PaxC ${suffix}`, telegramUserId: BigInt(6400000 + (suffix % 100000)), avatar: "" } }),
    ]);
    await db.booking.create({ data: { tripId: ownTrip.id, passengerId: paxPending.id, seat: 1, status: "pending" } });
    await db.booking.create({ data: { tripId: ownTrip.id, passengerId: paxConfirmed.id, seat: 2, status: "confirmed" } });
    const originalName = (
      await db.user.findUnique({ where: { id: userId }, select: { name: true } })
    )?.name;
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(200);
      const trip = await db.trip.findUnique({ where: { id: ownTrip.id } });
      expect(trip?.status).toBe("completed");
      expect(trip?.seatsAvailable).toBe(0);
      const bookings = await db.booking.findMany({ where: { tripId: ownTrip.id } });
      expect(bookings.find((b) => b.seat === 1)?.status).toBe("declined");
      expect(bookings.find((b) => b.seat === 2)?.status).toBe("confirmed");
      const confirmedAfter = await db.user.findUnique({ where: { id: paxConfirmed.id } });
      expect(confirmedAfter?.tripsCount).toBe(1);
      const notification = await db.notification.findFirst({
        where: { userId: paxConfirmed.id, type: "trip_status_changed" },
      });
      // Имя фиксируется до обезличивания: иначе получатель увидел бы
      // «Удалённый пользователь» вместо имени водителя.
      expect(notification?.actorName).toBe(originalName);
      const tombstone = await db.user.findUnique({ where: { id: userId } });
      expect(tombstone?.deletedAt).not.toBeNull();
    } finally {
      await db.booking.deleteMany({ where: { tripId: ownTrip.id } });
      await db.trip.delete({ where: { id: ownTrip.id } });
      await db.user.deleteMany({ where: { id: { in: [paxPending.id, paxConfirmed.id] } } });
    }
  });

  it("cancels own bookings on active trips on deletion (seat restored)", async () => {
    await db.trip.update({ where: { id: tripId }, data: { seatsAvailable: 2 } });
    const booking = await db.booking.create({ data: { tripId, passengerId: userId, seat: 1, status: "confirmed" } });
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(200);
      const cancelled = await db.booking.findUnique({ where: { id: booking.id } });
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.cancelledByType).toBe("user");
      const trip = await db.trip.findUnique({ where: { id: tripId } });
      expect(trip?.seatsAvailable).toBe(3);
    } finally {
      await db.booking.delete({ where: { id: booking.id } });
    }
  });

  it("allows deletion with bookings only on completed trips (history)", async () => {
    await db.trip.update({ where: { id: tripId }, data: { status: "completed" } });
    await db.booking.create({ data: { tripId, passengerId: userId, seat: 1, status: "confirmed" } });
    try {
      const response = await app.request("/api/v1/users/me", { method: "DELETE", headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` } });
      expect(response.status).toBe(200);
    } finally {
      await db.booking.deleteMany({ where: { passengerId: userId } });
    }
  });

  it("does not recreate a deleted account on the same Telegram identity", async () => {
    const telegramUserId = (
      await db.user.findUnique({ where: { id: userId }, select: { telegramUserId: true } })
    )?.telegramUserId;
    if (telegramUserId === null || telegramUserId === undefined) {
      throw new Error("Expected seeded Telegram identity");
    }
    const deletion = await app.request("/api/v1/users/me", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${devMockAccessToken(userId)}` },
    });
    expect(deletion.status).toBe(200);
    // Bypass fail-closed (F6): id обязан быть в allowlist.
    registerDevTelegramUser(telegramUserId);
    const initData = new URLSearchParams([
      ["user", JSON.stringify({ id: Number(telegramUserId), first_name: "Del" })],
      ["auth_date", String(Math.floor(Date.now() / 1000))],
      ["hash", "dev-hash"],
    ]).toString();
    const response = await app.request("/api/v1/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Account is deleted");
    expect(await db.user.count({ where: { telegramUserId } })).toBe(1);
  });
});
