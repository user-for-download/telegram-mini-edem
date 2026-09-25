import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * F1: телефон водителя в GET /trips/:id и PATCH /users/me.
 *
 * Приватность строже адресов: номер видит только водитель
 * и ПОДТВЕРЖДЁННЫЙ пассажир. Pending-заявитель и посторонние —
 * никогда. Владелец видит/правит свой номер через /me.
 *
 * Паттерн: trip-address-visibility.test.ts (app.request, mock-токены,
 * уникальные telegramUserId).
 */
describe("F1: driver phone visibility", () => {
  let driverId: string;
  let tripId: string;
  const createdUserIds: string[] = [];
  let tgSeq = 1_800_000n;

  const createUser = async (name: string, phone?: string) => {
    const user = await db.user.create({
      data: {
        name: `${name}-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=5",
        ...(phone ? { phone } : {}),
      },
    });
    createdUserIds.push(user.id);
    return user;
  };

  beforeEach(async () => {
    const driver = await createUser("PhoneDriver", "+79001234567");
    driverId = driver.id;
    const trip = await db.trip.create({
      data: {
        driverId,
        fromCity: "Москва",
        fromAddress: "м. Тёплый Стан",
        toCity: "Тула",
        toAddress: "пл. Ленина",
        departureAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 180,
        distanceKm: 180,
        price: 800,
        seatsTotal: 3,
        seatsAvailable: 3,
        tags: [],
      },
    });
    tripId = trip.id;
  });

  afterEach(async () => {
    await db.booking.deleteMany({ where: { tripId } });
    await db.trip.deleteMany({ where: { id: tripId } });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  const getTrip = async (userId?: string) => {
    const res = await app.request(`/api/v1/trips/${tripId}`, {
      headers: userId
        ? { Authorization: `Bearer ${devMockAccessToken(userId)}` }
        : {},
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<{ driver: { phone?: string } }>;
  };

  it("водитель видит свой номер в деталях", async () => {
    const body = await getTrip(driverId);
    expect(body.driver.phone).toBe("+79001234567");
  });

  it("confirmed-пассажир видит номер водителя", async () => {
    const pax = await createUser("PaxConfirmed");
    await db.booking.create({
      data: { tripId, passengerId: pax.id, seat: 1, status: "confirmed" },
    });
    const body = await getTrip(pax.id);
    expect(body.driver.phone).toBe("+79001234567");
  });

  it("pending-заявитель номер НЕ видит", async () => {
    const pax = await createUser("PaxPending");
    await db.booking.create({
      data: { tripId, passengerId: pax.id, seat: 1, status: "pending" },
    });
    const body = await getTrip(pax.id);
    expect(body.driver.phone).toBeUndefined();
  });

  it("посторонний номер НЕ видит", async () => {
    const stranger = await createUser("Stranger");
    const body = await getTrip(stranger.id);
    expect(body.driver.phone).toBeUndefined();
  });

  it("без номера у водителя — поле отсутствует даже для confirmed", async () => {
    await db.user.update({ where: { id: driverId }, data: { phone: null } });
    const pax = await createUser("PaxNoPhone");
    await db.booking.create({
      data: { tripId, passengerId: pax.id, seat: 1, status: "confirmed" },
    });
    const body = await getTrip(pax.id);
    expect(body.driver.phone).toBeUndefined();
  });

  it("PATCH /me: установка, нормализация, очистка, 400 на мусор", async () => {
    const user = await createUser("PhoneOwner");
    const token = devMockAccessToken(user.id);
    const patch = (body: unknown) =>
      app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

    const set = await patch({ phone: "+7 (900) 123-45-67" });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { phone?: string }).phone).toBe("+79001234567");

    const me = await app.request("/api/v1/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(((await me.json()) as { phone?: string }).phone).toBe("+79001234567");

    const bad = await patch({ phone: "не номер" });
    expect(bad.status).toBe(400);

    const clear = await patch({ phone: null });
    expect(clear.status).toBe(200);
    expect(((await clear.json()) as { phone?: string }).phone).toBeUndefined();
  });

  it("публичный GET /users/:id номер НЕ отдаёт", async () => {
    const user = await createUser("PhonePublic", "+79007654321");
    const res = await app.request(`/api/v1/users/${user.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { phone?: string }).phone).toBeUndefined();
  });
});
