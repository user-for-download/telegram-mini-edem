// backend/prisma/seed-user-trips.ts — тестовый ПРОД-сид с реальным юзером.
//
// Наполняет приложение данными вокруг КОНКРЕТНОГО пользователя (SEED_USER_ID):
// его поездки + мок-окружение (водители, попутчики, их поездки, брони,
// отзывы, уведомления). Строку реального User НЕ меняет и НЕ удаляет.
// Самодостаточен: id с префиксом tp-/t-bezz- не пересекаются с полным
// dev-сидом (u-N/t-N), чужие данные НЕ трогает. Идемпотентен: повторный
// прогон чистит только свои id и создаёт заново.
//
// Использование (repo root, ПРОД-контейнер — там DATABASE_URL уже на прод-БД):
//   docker compose exec -T -e SEED_USER_ID=<uuid> backend npx tsx prisma/seed-user-trips.ts
// (файл должен попасть в контейнер: docker cp backend/prisma/seed-user-trips.ts
//  telegram-mini-edem-backend-1:/app/prisma/seed-user-trips.ts)
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("[seed-user-trips] DATABASE_URL не задан");
if (!process.env.SEED_USER_ID) {
  throw new Error("[seed-user-trips] SEED_USER_ID не задан");
}
// Явная аннотация: сужение process.env через guard не переживает границу
// функции main(), без неё tsc (docker build) падает на каждом использовании.
const USER_ID: string = process.env.SEED_USER_ID;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const DEFAULT_AVATAR_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%23E5E7EB'/%3E%3Ccircle cx='100' cy='75' r='38' fill='%239CA3AF'/%3E%3Cpath d='M30 185c8-40 36-60 70-60s62 20 70 60z' fill='%239CA3AF'/%3E%3C/svg%3E";

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 3_600_000;
const now = new Date();
const anchor = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
// День + час МСК (UTC+3 круглый год).
const days = (n: number, hourMsk = 9): Date =>
  new Date(anchor.getTime() + n * dayMs + (hourMsk - 3) * hourMs);

// Мок-окружение (фиктивные TG-id 79990000001+ — явно тестовые).
const D1 = "u-tp-d1"; // Илья Северов, водитель
const D2 = "u-tp-d2"; // Елена Смирнова, водитель
const P1 = "u-tp-p1"; // Дмитрий К, попутчик
const P2 = "u-tp-p2"; // Анна В, попутчица
const MOCK_IDS = [D1, D2, P1, P2];
const ALL_TRIPS = [
  "t-bezz-1",
  "t-bezz-2",
  "t-bezz-past-1",
  "t-tp-1",
  "t-tp-2",
  "t-tp-past-1",
];
const ALL_REVIEWS = ["r-tp-1", "r-tp-2", "r-tp-3", "r-tp-4"];

async function cityId(name: string): Promise<string> {
  const norm = name.trim().toLowerCase();
  const city = await prisma.city.findFirst({ where: { nameNormalized: norm } });
  if (!city) throw new Error(`[seed-user-trips] город «${name}» отсутствует`);
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
  const user = await prisma.user.findUnique({ where: { id: USER_ID } });
  if (!user) throw new Error("[seed-user-trips] пользователь не найден, стоп");
  const vologda = await cityId("Вологда");
  const cherepovets = await cityId("Череповец");

  // Чистим только свои прошлые прогоны (идемпотентность), FK-порядок.
  await prisma.notification.deleteMany({
    where: { userId: USER_ID, title: { contains: "Bezz-тест" } },
  });
  await prisma.review.deleteMany({ where: { id: { in: ALL_REVIEWS } } });
  await prisma.booking.deleteMany({ where: { tripId: { in: ALL_TRIPS } } });
  await prisma.trip.deleteMany({ where: { id: { in: ALL_TRIPS } } });
  await prisma.car.deleteMany({ where: { userId: { in: MOCK_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: MOCK_IDS } } });

  // Мок-пользователи (upsert не нужен — только что удалили, create).
  const mockUsers = [
    {
      id: D1,
      telegramUserId: 79990000001n,
      name: "Илья Северов",
      about: "Езжу Вологда — Череповец каждую неделю.",
      tripsCount: 12,
    },
    {
      id: D2,
      telegramUserId: 79990000002n,
      name: "Елена Смирнова",
      about: "Спокойный стиль вождения, без музыки.",
      tripsCount: 7,
    },
    { id: P1, telegramUserId: 79990000003n, name: "Дмитрий К", tripsCount: 0 },
    { id: P2, telegramUserId: 79990000004n, name: "Анна В", tripsCount: 0 },
  ];
  for (const u of mockUsers) {
    await prisma.user.create({
      data: {
        id: u.id,
        telegramUserId: u.telegramUserId,
        name: u.name,
        avatar: DEFAULT_AVATAR_URL,
        about: "about" in u ? (u as { about: string }).about : null,
        tripsCount: u.tripsCount,
      },
    });
  }
  await prisma.car.createMany({
    data: [
      { userId: D1, model: "Kia Rio", color: "серый" },
      { userId: D2, model: "Hyundai Solaris", color: "белый" },
    ],
  });
  // Машина реального пользователя (upsert — могла остаться с прошлого).
  await prisma.car.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, model: "Lada Vesta", color: "белый" },
    update: {},
  });

  // ── Поездки реального пользователя ──
  const t1Departure = days(2, 8);
  const t1Created = new Date(t1Departure.getTime() - 3 * dayMs);
  await prisma.trip.create({
    data: {
      id: "t-bezz-1",
      driverId: USER_ID,
      fromCity: "Вологда",
      fromAddress: "Автовокзал",
      toCity: "Череповец",
      toAddress: "Октябрьский проспект",
      fromCityId: vologda,
      toCityId: cherepovets,
      departureAt: t1Departure,
      durationMinutes: 110,
      distanceKm: 155,
      price: 450,
      seatsTotal: 3,
      seatsAvailable: 1,
      status: "active",
      tags: ["Есть багаж"],
      comment: "Bezz-тест: еду в Череповец, беру попутчиков.",
      createdAt: t1Created,
      updatedAt: t1Created,
      bookings: {
        create: [
          {
            id: "b-tp-bezz-1-p1",
            passengerId: P1,
            seat: 1,
            status: "confirmed",
            comment: "Буду с рюкзаком.",
            createdAt: new Date(t1Created.getTime() + dayMs),
          },
          {
            id: "b-tp-bezz-1-p2",
            passengerId: P2,
            seat: 2,
            status: "pending",
            comment: "Возьмите, пожалуйста!",
            expiresAt: new Date(now.getTime() + 24 * hourMs),
            createdAt: new Date(t1Created.getTime() + dayMs),
          },
        ],
      },
    },
  });

  const t2Departure = days(6, 18);
  const t2Created = new Date(t2Departure.getTime() - 3 * dayMs);
  await prisma.trip.create({
    data: {
      id: "t-bezz-2",
      driverId: USER_ID,
      fromCity: "Череповец",
      fromAddress: "Автовокзал",
      toCity: "Вологда",
      toAddress: "Ж/д вокзал",
      fromCityId: cherepovets,
      toCityId: vologda,
      departureAt: t2Departure,
      durationMinutes: 110,
      distanceKm: 155,
      price: 500,
      seatsTotal: 3,
      seatsAvailable: 3,
      status: "active",
      tags: ["Тихая поездка"],
      comment: "Bezz-тест: обратная дорога.",
      createdAt: t2Created,
      updatedAt: t2Created,
    },
  });

  const tPastDeparture = days(-4, 8);
  const tPastCreated = new Date(tPastDeparture.getTime() - 3 * dayMs);
  const tPastBookingCreated = new Date(tPastCreated.getTime() + dayMs);
  const tPastReviewCreated = new Date(tPastDeparture.getTime() + dayMs);
  await prisma.trip.create({
    data: {
      id: "t-bezz-past-1",
      driverId: USER_ID,
      fromCity: "Вологда",
      fromAddress: "Ж/д вокзал",
      toCity: "Череповец",
      toAddress: "Автовокзал",
      fromCityId: vologda,
      toCityId: cherepovets,
      departureAt: tPastDeparture,
      durationMinutes: 110,
      distanceKm: 155,
      price: 450,
      seatsTotal: 3,
      seatsAvailable: 2,
      status: "completed",
      tags: ["Есть багаж"],
      comment: "Bezz-тест: съездили отлично.",
      createdAt: tPastCreated,
      updatedAt: tPastCreated,
      bookings: {
        create: [
          {
            id: "b-tp-bezz-past-1-p1",
            passengerId: P1,
            seat: 1,
            status: "confirmed",
            comment: "Спасибо!",
            createdAt: tPastBookingCreated,
          },
        ],
      },
    },
  });

  // ── Поездки других людей ──
  const m1Departure = days(3, 8);
  const m1Created = new Date(m1Departure.getTime() - 3 * dayMs);
  const m1BookingCreated = new Date(m1Created.getTime() + dayMs);
  await prisma.trip.create({
    data: {
      id: "t-tp-1",
      driverId: D1,
      fromCity: "Вологда",
      fromAddress: "Торговый центр",
      toCity: "Череповец",
      toAddress: "Вокзал",
      fromCityId: vologda,
      toCityId: cherepovets,
      departureAt: m1Departure,
      durationMinutes: 120,
      distanceKm: 155,
      price: 400,
      seatsTotal: 3,
      seatsAvailable: 1,
      status: "active",
      tags: ["С остановками"],
      comment: "Еду по делам, возьму двоих.",
      createdAt: m1Created,
      updatedAt: m1Created,
      bookings: {
        create: [
          {
            id: "b-tp-1-bezz",
            passengerId: USER_ID,
            seat: 3,
            status: "confirmed",
            comment: "Bezz-тест: буду вовремя.",
            createdAt: m1BookingCreated,
          },
          {
            id: "b-tp-1-p2",
            passengerId: P2,
            seat: 1,
            status: "pending",
            comment: "Можно с собакой? Она спокойная.",
            expiresAt: new Date(now.getTime() + 24 * hourMs),
            createdAt: m1BookingCreated,
          },
        ],
      },
    },
  });

  const m2Departure = days(5, 18);
  const m2Created = new Date(m2Departure.getTime() - 2 * dayMs);
  await prisma.trip.create({
    data: {
      id: "t-tp-2",
      driverId: D2,
      fromCity: "Череповец",
      fromAddress: "Площадь Металлургов",
      toCity: "Вологда",
      toAddress: "Торговый центр",
      fromCityId: cherepovets,
      toCityId: vologda,
      departureAt: m2Departure,
      durationMinutes: 115,
      distanceKm: 155,
      price: 500,
      seatsTotal: 3,
      seatsAvailable: 3,
      status: "active",
      tags: ["Тихая поездка"],
      comment: "Возвращаюсь домой вечером.",
      createdAt: m2Created,
      updatedAt: m2Created,
    },
  });

  const mPastDeparture = days(-6, 9);
  const mPastCreated = new Date(mPastDeparture.getTime() - 3 * dayMs);
  const mPastBookingCreated = new Date(mPastCreated.getTime() + dayMs);
  const mPastReviewCreated = new Date(mPastDeparture.getTime() + dayMs);
  await prisma.trip.create({
    data: {
      id: "t-tp-past-1",
      driverId: D1,
      fromCity: "Вологда",
      fromAddress: "Автовокзал",
      toCity: "Череповец",
      toAddress: "Октябрьский проспект",
      fromCityId: vologda,
      toCityId: cherepovets,
      departureAt: mPastDeparture,
      durationMinutes: 110,
      distanceKm: 155,
      price: 400,
      seatsTotal: 3,
      seatsAvailable: 2,
      status: "completed",
      tags: [],
      comment: "Утренний рейс.",
      createdAt: mPastCreated,
      updatedAt: mPastCreated,
      bookings: {
        create: [
          {
            id: "b-tp-past-1-bezz",
            passengerId: USER_ID,
            seat: 2,
            status: "confirmed",
            comment: "Bezz-тест: спасибо!",
            createdAt: mPastBookingCreated,
          },
        ],
      },
    },
  });

  // ── Отзывы (опубликованные, в обе стороны) ──
  await prisma.review.createMany({
    data: [
      {
        id: "r-tp-1",
        authorId: USER_ID,
        targetUserId: D1,
        targetRole: "driver",
        rating: 5,
        status: "published",
        text: "Bezz-тест: отличный водитель!",
        tripRoute: "Вологда → Череповец",
        tripId: "t-tp-past-1",
        createdAt: mPastReviewCreated,
      },
      {
        id: "r-tp-2",
        authorId: D1,
        targetUserId: USER_ID,
        targetRole: "passenger",
        rating: 5,
        status: "published",
        text: "Bezz-тест: приятный попутчик.",
        tripRoute: "Вологда → Череповец",
        tripId: "t-tp-past-1",
        createdAt: mPastReviewCreated,
      },
      {
        id: "r-tp-3",
        authorId: P1,
        targetUserId: USER_ID,
        targetRole: "driver",
        rating: 5,
        status: "published",
        text: "Bezz-тест: довёз быстро и аккуратно.",
        tripRoute: "Вологда → Череповец",
        tripId: "t-bezz-past-1",
        createdAt: tPastReviewCreated,
      },
      {
        id: "r-tp-4",
        authorId: USER_ID,
        targetUserId: P1,
        targetRole: "passenger",
        rating: 4,
        status: "published",
        text: "Bezz-тест: хороший попутчик, чуть опоздал.",
        tripRoute: "Вологда → Череповец",
        tripId: "t-bezz-past-1",
        createdAt: tPastReviewCreated,
      },
    ],
  });

  // ── Уведомления реальному пользователю ──
  await prisma.notification.createMany({
    data: [
      {
        userId: USER_ID,
        type: "booking_created",
        title: "Bezz-тест: новая заявка",
        body: "Анна В хочет присоединиться к вашей поездке Вологда → Череповец.",
        isRead: false,
        createdAt: new Date(now.getTime() - 2 * hourMs),
      },
      {
        userId: USER_ID,
        type: "booking_confirmed",
        title: "Bezz-тест: бронирование подтверждено",
        body: "Илья Северов подтвердил вашу поездку Вологда → Череповец.",
        isRead: false,
        createdAt: new Date(now.getTime() - 5 * hourMs),
      },
      {
        userId: USER_ID,
        type: "trip_completed",
        title: "Bezz-тест: поездка завершена",
        body: "Поездка Вологда → Череповец завершена. Оставьте отзыв водителю!",
        isRead: false,
        createdAt: new Date(now.getTime() - 8 * hourMs),
      },
    ],
  });

  // Рейтинг/счётчик по опубликованным — затронутые пользователи.
  for (const userId of [USER_ID, D1, P1]) {
    await refreshRating(userId);
  }

  console.log(
    "[seed-user-trips] ok: 6 поездок (3 свои + 3 чужие), 4 мок-юзера, " +
      "6 броней, 4 отзыва, 3 уведомления",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
