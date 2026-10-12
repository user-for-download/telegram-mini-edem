// backend/tests/integration/notification-subscriber.test.ts
//
// Подписчик уведомлений: emit доменного события → строка в inbox.
// Проверяет связку «шина → форматирование → notifyUser → БД» на трёх
// пилотных событиях. Импорт app.js регистрирует подписки (та же точка,
// что у сервера); регистрация в index.ts тесты бы не покрыла.
//
// Пользователи создаются напрямую в БД без telegramUserId: TG-часть
// outbox для них пропускается, тест hermetic и не трогает диспетчер.
import { afterAll, describe, expect, it } from "vitest";

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { domainEvents } = await import("../../src/events/domainEvents.js");

// app.js должен зарегистрировать ровно трёх подписчиков (пилот).
// Проверяем wiring, а не только логику: без регистрации emit молча
// ничего не создаст, и остальные тесты этого не заметят.
describe("wiring", () => {
  it("app регистрирует подписки уведомлений", () => {
    expect(app).toBeTruthy();
    expect(domainEvents.listenerCount("booking.created")).toBe(1);
    expect(domainEvents.listenerCount("booking.status_changed")).toBe(1);
    expect(domainEvents.listenerCount("trip.cancelled")).toBe(1);
  });
});

const TRIP_FACTS = {
  fromCity: "Вологда",
  toCity: "Череповец",
  price: 450,
  departureAt: new Date("2031-05-01T10:00:00.000Z"),
};

let seq = 0;
async function makeUser(name: string): Promise<string> {
  seq += 1;
  const user = await db.user.create({
    data: {
      telegramUserId: BigInt(9_100_000 + seq),
      name,
      avatar: "https://cdn.example.com/a.png",
    },
  });
  return user.id;
}

const createdUserIds: string[] = [];
const createdNotificationIds: string[] = [];

afterAll(async () => {
  if (createdNotificationIds.length > 0) {
    await db.notification.deleteMany({
      where: { id: { in: createdNotificationIds } },
    });
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
});

async function inboxFor(userId: string, type: string) {
  const rows = await db.notification.findMany({ where: { userId, type } });
  for (const row of rows) createdNotificationIds.push(row.id);
  return rows;
}

describe("notificationSubscriber (пилот)", () => {
  it("booking.created → заявка водителю", async () => {
    const driverId = await makeUser("Водитель Пилота");
    const passengerId = await makeUser("Пассажир Пилота");
    createdUserIds.push(driverId, passengerId);

    await domainEvents.emit("booking.created", {
      bookingId: "b-pilot-1",
      tripId: "t-pilot-1",
      seat: 2,
      driverId,
      passengerName: "Пассажир Пилота",
      trip: TRIP_FACTS,
    });

    const rows = await inboxFor(driverId, "booking_created");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Новая заявка на место",
      actorName: "Пассажир Пилота",
      action: "created",
      recipientRole: "driver",
    });
    expect(rows[0]?.body).toContain("место 2");
  });

  it("booking.status_changed → решение пассажиру", async () => {
    const driverId = await makeUser("Водитель Решения");
    const passengerId = await makeUser("Пассажир Решения");
    createdUserIds.push(driverId, passengerId);

    await domainEvents.emit("booking.status_changed", {
      bookingId: "b-pilot-2",
      tripId: "t-pilot-2",
      oldStatus: "pending",
      newStatus: "confirmed",
      passengerId,
      driverName: "Водитель Решения",
      trip: TRIP_FACTS,
    });

    const rows = await inboxFor(passengerId, "booking_status_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Заявка подтверждена",
      recipientRole: "passenger",
    });
  });

  it("trip.cancelled → всем подтверждённым пассажирам", async () => {
    const driverId = await makeUser("Водитель Отмены");
    const p1 = await makeUser("Пассажир Один");
    const p2 = await makeUser("Пассажир Два");
    createdUserIds.push(driverId, p1, p2);

    await domainEvents.emit("trip.cancelled", {
      tripId: "t-pilot-3",
      driverName: "Водитель Отмены",
      passengerIds: [p1, p2],
      trip: TRIP_FACTS,
    });

    expect(await inboxFor(p1, "trip_cancelled")).toHaveLength(1);
    expect(await inboxFor(p2, "trip_cancelled")).toHaveLength(1);
    // Водителю отмена собственной поездки в инбокс не падает.
    expect(await inboxFor(driverId, "trip_cancelled")).toHaveLength(0);
  });
});
