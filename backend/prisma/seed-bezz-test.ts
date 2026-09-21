// backend/prisma/seed-bezz-test.ts — точечный сид для теста.
// Только пользователь Bezz (5756610948): поездки, брони, отзывы, уведомления.
// Остальные данные НЕ трогает. Идемпотентен по фиксированным id.
// Запуск: DATABASE_URL=<prod через relay> npx tsx prisma/seed-bezz-test.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("[seed-bezz] DATABASE_URL не задан");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const BEZZ = "e9959223-e7ac-40b4-b510-d31659872f39";
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 3_600_000;
const now = new Date();
const anchor = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
// День + час МСК (UTC+3 круглый год): раньше все отправления были
// в 00:00 UTC (03:00 МСК), createdAt — «момент сида».
const days = (n: number, hourMsk = 9): Date =>
  new Date(anchor.getTime() + n * dayMs + (hourMsk - 3) * hourMs);

async function cityId(name: string): Promise<string> {
  const norm = name.trim().toLowerCase();
  const city = await prisma.city.findFirst({ where: { nameNormalized: norm } });
  if (!city) throw new Error(`[seed-bezz] город «${name}» отсутствует`);
  return city.id;
}

async function refreshRating(userId: string): Promise<void> {
  const agg = await prisma.review.aggregate({
    where: { targetUserId: userId, status: "published" },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.user.update({
    where: { id: userId },
    data: {
      rating: agg._avg.rating ?? 5,
      reviewsCount: agg._count._all,
    },
  });
}

async function main(): Promise<void> {
  const bezz = await prisma.user.findUnique({ where: { id: BEZZ } });
  if (!bezz || bezz.telegramUserId !== 5756610948n) {
    throw new Error("[seed-bezz] пользователь Bezz не найден, стоп");
  }
  const vologda = await cityId("Вологда");
  const cherepovets = await cityId("Череповец");

  // Чистим только свои прошлые прогоны (идемпотентность).
  const ownTrips = ["t-bezz-1", "t-bezz-2", "t-bezz-past-1"];
  const ownReviews = ["r-bezz-1", "r-bezz-2", "r-bezz-3", "r-bezz-4"];
  await prisma.review.deleteMany({ where: { id: { in: ownReviews } } });
  await prisma.booking.deleteMany({
    where: {
      OR: [
        { tripId: { in: ownTrips } },
        { passengerId: BEZZ, tripId: { in: ["t-1", "t-4", "t-past-7"] } },
      ],
    },
  });
  await prisma.notification.deleteMany({
    where: { userId: BEZZ, title: { contains: "Bezz-тест" } },
  });
  await prisma.trip.deleteMany({ where: { id: { in: ownTrips } } });

  // Машина водителя (upsert).
  await prisma.car.upsert({
    where: { userId: BEZZ },
    create: { userId: BEZZ, model: "Lada Vesta", color: "белый" },
    update: {},
  });

  // 1) Активная поездка водителя с заявками (approve-флоу).
  // Создана за 3 дня до отправления; брони — через день после создания;
  // pending живёт 24ч (TTL как рантайм — иначе фильтры «не истёкшая»
  // заявку без expiresAt могут не видеть).
  const bezz1Departure = days(2, 8);
  const bezz1Created = new Date(bezz1Departure.getTime() - 3 * dayMs);
  const bezz1BookingCreated = new Date(bezz1Created.getTime() + dayMs);
  await prisma.trip.create({
    data: {
      id: "t-bezz-1",
      driverId: BEZZ,
      fromCity: "Вологда",
      fromAddress: "Автовокзал",
      toCity: "Череповец",
      toAddress: "Октябрьский проспект",
      fromCityId: vologda,
      toCityId: cherepovets,
      departureAt: bezz1Departure,
      durationMinutes: 110,
      distanceKm: 155,
      price: 450,
      seatsTotal: 3,
      seatsAvailable: 1,
      status: "active",
      tags: ["Есть багаж"],
      comment: "Bezz-тест: еду в Череповец, беру попутчиков.",
      createdAt: bezz1Created,
      updatedAt: bezz1Created,
      bookings: {
        create: [
          {
            id: "booking-t-bezz-1-u-4-1",
            passengerId: "u-4",
            seat: 1,
            status: "confirmed",
            comment: "Буду с рюкзаком.",
            createdAt: bezz1BookingCreated,
          },
          {
            id: "booking-t-bezz-1-u-15-2",
            passengerId: "u-15",
            seat: 2,
            status: "pending",
            comment: "Возьмите, пожалуйста!",
            expiresAt: new Date(now.getTime() + 24 * hourMs),
            createdAt: bezz1BookingCreated,
          },
        ],
      },
    },
  });

  // 2) Активная поездка водителя без броней.
  const bezz2Departure = days(6, 18);
  const bezz2Created = new Date(bezz2Departure.getTime() - 3 * dayMs);
  await prisma.trip.create({
    data: {
      id: "t-bezz-2",
      driverId: BEZZ,
      fromCity: "Череповец",
      fromAddress: "Автовокзал",
      toCity: "Вологда",
      toAddress: "Ж/д вокзал",
      fromCityId: cherepovets,
      toCityId: vologda,
      departureAt: bezz2Departure,
      durationMinutes: 110,
      distanceKm: 155,
      price: 500,
      seatsTotal: 3,
      seatsAvailable: 3,
      status: "active",
      tags: ["Тихая поездка"],
      comment: "Bezz-тест: обратная дорога.",
      createdAt: bezz2Created,
      updatedAt: bezz2Created,
    },
  });

  // 3) Завершённая поездка водителя + отзывы обе стороны.
  // Отзывы — на следующий день после поездки, а не «сейчас».
  const bezzPastDeparture = days(-4, 8);
  const bezzPastCreated = new Date(bezzPastDeparture.getTime() - 3 * dayMs);
  const bezzPastBookingCreated = new Date(bezzPastCreated.getTime() + dayMs);
  const bezzPastReviewCreated = new Date(bezzPastDeparture.getTime() + dayMs);
  await prisma.trip.create({
    data: {
      id: "t-bezz-past-1",
      driverId: BEZZ,
      fromCity: "Вологда",
      fromAddress: "Ж/д вокзал",
      toCity: "Череповец",
      toAddress: "Автовокзал",
      fromCityId: vologda,
      toCityId: cherepovets,
      departureAt: bezzPastDeparture,
      durationMinutes: 110,
      distanceKm: 155,
      price: 450,
      seatsTotal: 3,
      seatsAvailable: 0,
      status: "completed",
      tags: ["Есть багаж"],
      comment: "Bezz-тест: съездили отлично.",
      createdAt: bezzPastCreated,
      updatedAt: bezzPastCreated,
      bookings: {
        create: [
          {
            id: "booking-t-bezz-past-1-u-19-1",
            passengerId: "u-19",
            seat: 1,
            status: "confirmed",
            comment: "Спасибо!",
            createdAt: bezzPastBookingCreated,
          },
        ],
      },
    },
  });
  await prisma.review.createMany({
    data: [
      {
        id: "r-bezz-1",
        authorId: "u-19",
        targetUserId: BEZZ,
        targetRole: "driver",
        rating: 5,
        status: "published",
        text: "Bezz-тест: отличный водитель!",
        tripRoute: "Вологда → Череповец",
        tripId: "t-bezz-past-1",
        createdAt: bezzPastReviewCreated,
      },
      {
        id: "r-bezz-2",
        authorId: BEZZ,
        targetUserId: "u-19",
        targetRole: "passenger",
        rating: 5,
        status: "published",
        text: "Bezz-тест: приятный попутчик.",
        tripRoute: "Вологда → Череповец",
        tripId: "t-bezz-past-1",
        createdAt: bezzPastReviewCreated,
      },
    ],
  });

  // 4) Брони пассажира: confirmed (t-1), pending (t-4), история (t-past-7).
  // createdAt — недавно (день назад и менее), pending с TTL 24ч как рантайм.
  const bezzBookingRecent = new Date(now.getTime() - 5 * hourMs);
  await prisma.booking.createMany({
    data: [
      {
        id: "booking-t-1-bezz-3",
        tripId: "t-1",
        passengerId: BEZZ,
        seat: 3,
        status: "confirmed",
        comment: "Bezz-тест: буду вовремя.",
        createdAt: bezzBookingRecent,
      },
      {
        id: "booking-t-4-bezz-3",
        tripId: "t-4",
        passengerId: BEZZ,
        seat: 3,
        status: "pending",
        comment: "Bezz-тест: возьмите меня.",
        expiresAt: new Date(now.getTime() + 24 * hourMs),
        createdAt: bezzBookingRecent,
      },
      {
        id: "booking-t-past-7-bezz-3",
        tripId: "t-past-7",
        passengerId: BEZZ,
        seat: 3,
        status: "confirmed",
        createdAt: new Date(days(-1).getTime()),
      },
    ],
  });
  // Места — пересчётом, а не decrement (идемпотентно при реранах:
  // cleanup удаляет брони, но не возвращает seatsAvailable).
  for (const tripId of ["t-1", "t-4"]) {
    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { seatsTotal: true },
    });
    const reserved = await prisma.booking.count({
      where: { tripId, status: { in: ["pending", "confirmed"] } },
    });
    await prisma.trip.update({
      where: { id: tripId },
      data: { seatsAvailable: trip.seatsTotal - reserved },
    });
  }
  await prisma.review.createMany({
    data: [
      {
        id: "r-bezz-3",
        authorId: BEZZ,
        targetUserId: "u-5",
        targetRole: "driver",
        rating: 4,
        status: "published",
        text: "Bezz-тест: хорошая поездка.",
        tripRoute: "Грязовец → Вологда",
        tripId: "t-past-7",
        createdAt: new Date(days(0).getTime()),
      },
      {
        id: "r-bezz-4",
        authorId: "u-5",
        targetUserId: BEZZ,
        targetRole: "passenger",
        rating: 5,
        status: "published",
        text: "Bezz-тест: пунктуальный пассажир.",
        tripRoute: "Грязовец → Вологда",
        tripId: "t-past-7",
        createdAt: new Date(days(0).getTime()),
      },
    ],
  });

  // 5) Уведомления водителю/пассажиру (не все «сейчас» — разброс по часам).
  await prisma.notification.createMany({
    data: [
      {
        userId: BEZZ,
        type: "booking_created",
        title: "Bezz-тест: новая заявка",
        body: "Елена Смирнова хочет присоединиться к вашей поездке Вологда → Череповец.",
        isRead: false,
        createdAt: new Date(now.getTime() - 3 * hourMs),
      },
      {
        userId: BEZZ,
        type: "booking_confirmed",
        title: "Bezz-тест: бронирование подтверждено",
        body: "Илья Северов подтвердил вашу поездку Вологда → Череповец.",
        isRead: false,
        createdAt: new Date(now.getTime() - 6 * hourMs),
      },
    ],
  });

  // Рейтинг/счётчик по опубликованным — затронутые пользователи.
  for (const userId of [BEZZ, "u-19", "u-5"]) {
    await refreshRating(userId);
  }

  console.log("[seed-bezz] ok: 3 поездки, 5 броней, 4 отзыва, 2 уведомления");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
