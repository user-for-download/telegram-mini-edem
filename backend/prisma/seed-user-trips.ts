// backend/prisma/seed-user-trips.ts — тестовый ПРОД-сид с реальным юзером.
//
// Наполняет приложение данными вокруг КОНКРЕТНОГО пользователя (SEED_USER_ID):
// его поездки и заявки на попутку + мок-окружение (водители, попутчики, их
// поездки, брони, отзывы, уведомления). Строку реального User НЕ меняет и НЕ
// удаляет. Самодостаточен: id с префиксом tp-/t-bezz- не пересекаются с
// полным dev-сидом (u-N/t-N), чужие данные НЕ трогает. Идемпотентен:
// повторный прогон чистит только свои id и создаёт заново.
//
// ТОЛЬКО ПРОД. Гард `NODE_ENV=production` в начале файла: на dev-стенде
// скрипт падает, потому что там другой пользователь и другой набор данных,
// а мок-юзер с id u-tp-* стёр бы dev-сид.
//
// Использование (стенд с одним реальным TG-юзером):
//   docker compose exec -T -e SEED_USER_ID=<uuid> backend \
//     npx tsx prisma/seed-user-trips.ts
//   Требуется справочник городов, иначе падает «город «Вологда» отсутствует»:
//     docker compose exec -T backend npx tsx prisma/seed-cities.ts
//
//   НЕ путать с полным `db:seed` (dev-стенд): он сбрасывает ВСЕ таблицы
//   (см. seed.ts) и затирает полный набор данных.
//   Путь к сгенерированному клиенту (`../src/generated/prisma/client.js`)
//   одинаково работает на хосте и в контейнере: в образе его восстанавливает
//   симлинк /app/src/generated → /app/dist/src/generated (backend/Dockerfile).
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import {
  CRITICAL_NOTIFICATION_TYPES,
  NOTIFICATION_ROLE_TYPES,
  type NotificationRole,
} from "@edem/contracts";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Prisma 7 больше не подгружает .env автоматически — путь относительно файла
// (как в seed.ts), иначе хостовый запуск без экспорта DATABASE_URL падал бы.
loadEnv({ path: new URL("../.env", import.meta.url) });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("[seed-user-trips] DATABASE_URL не задан");
// Скрипт ТОЛЬКО для прода. Он пишет вокруг конкретного реального юзера
// (SEED_USER_ID) в боевой БД, поэтому случайный запуск на dev-стенде
// (host-команда из backend/.env → db-dev, где другой юзер и другой набор
// данных) — ошибка, а не мелочь: стёр бы чужие сид-данные, создав мок-юзера
// с id u-tp-* поверх dev-сида. Контейнер backend несёт
// ENV NODE_ENV=production (backend/Dockerfile), прод-стенд — тоже; dev —
// нет.
if (process.env.NODE_ENV !== "production") {
  throw new Error(
    "[seed-user-trips] только прод: NODE_ENV=production не задан. " +
      "На dev-стенде наполняет полный db:seed.",
  );
}
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

/**
 * Прод-сид пишет в БОЕВУЮ базу вокруг реального юзера, поэтому расхождение с
 * инвариантами рантайма здесь дороже обычного: строка, которой рантайм создать
 * не мог бы, делает прод-стенд бесполезным для проверки. Проверяем то же, что
 * проверяет код: окно заявки, её даты, лимит активных заявок, связку
 * «бронь ← заявка» и правдоподобие уведомлений.
 */
function validateUserTripSeed(input: {
  requests?: Array<{
    id: string;
    status: string;
    earliestAt: Date;
    latestAt: Date;
    expiresAt: Date;
    createdAt: Date;
  }>;
  notifications?: Array<{
    userId: string;
    type: string;
    recipientRole?: string;
    deepLink?: string;
  }>;
}): void {
  const requests = input.requests ?? [];
  for (const rr of requests) {
    // API отклоняет и равные границы (createRideRequestDtoSchema.superRefine).
    if (rr.earliestAt >= rr.latestAt) {
      throw new Error(
        `[seed-user-trips] ${rr.id}: окно инвертировано (earliest >= latest)`,
      );
    }
    // createdAt из будущего ставит заявку первой в «Моих заявках» (desc) и
    // делает её витринной при простановке Booking.requestId (asc).
    if (rr.createdAt > new Date()) {
      throw new Error(`[seed-user-trips] ${rr.id}: createdAt в будущем`);
    }
    // Статус expired в продукте недостижим (нет в мутабельном наборе, воркера
    // заявок нет) — он нужен только ради метки в UI, и метка должна быть правдой.
    if (rr.status === "expired" && rr.expiresAt > new Date()) {
      throw new Error(
        `[seed-user-trips] ${rr.id}: статус expired при expiresAt в будущем`,
      );
    }
  }

  // Прод-сид существует ради проверки полного цикла, значит у юзера должна
  // оставаться свободная квота активных заявок: иначе публикация новой
  // заявки вернёт 409 и предотправочное предупреждение нечем завершить.
  const live = requests.filter(
    (rr) =>
      (rr.status === "active" || rr.status === "paused") &&
      rr.expiresAt > new Date(),
  );
  if (live.length >= MAX_ACTIVE_REQUESTS_SEED) {
    throw new Error(
      `[seed-user-trips] у юзера ${live.length} живых заявок при лимите ` +
        `${MAX_ACTIVE_REQUESTS_SEED}: публикация новой вернёт 409`,
    );
  }

  // Связка «бронь ← заявка»: те же условия, что проверяет
  // closeRideRequestsForBooking — заявка закрыта, принадлежит пассажиру, и её
  // маршрут с окном совпадают с поездкой.
  const fulfilled = requests.find(
    (rr) => rr.id === FULFILLED_REQUEST_LINK.requestId,
  );
  if (fulfilled === undefined && requests.length > 0) {
    throw new Error(
      `[seed-user-trips] нет заявки ${FULFILLED_REQUEST_LINK.requestId} под ` +
        `бронь ${FULFILLED_REQUEST_LINK.bookingId}`,
    );
  }
  if (fulfilled === undefined) {
    // Заявки не проверялись в этом вызове (проверка уведомлений).
    return;
  }
  if (fulfilled.status !== "fulfilled") {
    throw new Error(
      `[seed-user-trips] ${fulfilled.id}linked, но статус ${fulfilled.status}: ` +
        "бронь закрывает только fulfilled",
    );
  }
  if (fulfilled.latestAt < FULFILLED_REQUEST_LINK.tripDepartureAt) {
    throw new Error(
      `[seed-user-trips] окно ${fulfilled.id} заканчивается раньше отправления ` +
        "поездки, на которую ссылается бронь",
    );
  }

  for (const n of input.notifications ?? []) {
    if (!SEED_NOTIFICATION_TYPES.has(n.type)) {
      throw new Error(`[seed-user-trips] неизвестный тип уведомления ${n.type}`);
    }
    const role = n.recipientRole as NotificationRole | undefined;
    if (
      role !== undefined &&
      !NOTIFICATION_ROLE_TYPES[role].has(n.type) &&
      !SEED_NEUTRAL_NOTIFICATION_TYPES.has(n.type)
    ) {
      throw new Error(
        `[seed-user-trips] тип ${n.type} не адресуется роли ${role}`,
      );
    }
    if (n.deepLink !== undefined && !SEED_DEEP_LINK_ALLOWED(n.deepLink)) {
      throw new Error(
        `[seed-user-trips] deep-link ${n.deepLink} вне allowlist бэка`,
      );
    }
  }
}

/** Лимит активных заявок на человека — зеркало backend/src/rideRequests/index.ts. */
const MAX_ACTIVE_REQUESTS_SEED = 3;

const SEED_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  ...CRITICAL_NOTIFICATION_TYPES,
  ...NOTIFICATION_ROLE_TYPES.driver,
  ...NOTIFICATION_ROLE_TYPES.passenger,
  "review_approved",
  "review_rejected",
  "feedback_replied",
]);

const SEED_NEUTRAL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "review_approved",
  "review_rejected",
  "feedback_replied",
]);

/** Маршруты, которые бэк отдаёт в Telegram без искажения (telegramNotifications). */
const SEED_DEEP_LINK_ALLOWED = (deepLink: string): boolean =>
  SEED_DEEP_LINK_EXACT.has(deepLink) ||
  /^\/trips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    deepLink,
  );

const SEED_DEEP_LINK_EXACT: ReadonlySet<string> = new Set([
  "/trips",
  "/trips/my",
  "/trips/my/new",
  "/bookings",
  "/bookings/history",
  "/notifications",
  "/profile/ride-requests",
  "/reviews",
]);

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 3_600_000;
const now = new Date();
const anchor = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
// День + час МСК (UTC+3 круглый год).
const days = (n: number, hourMsk = 9): Date =>
  new Date(anchor.getTime() + n * dayMs + (hourMsk - 3) * hourMs);

/**
 * Связка «заявка → бронь», которая обязана существовать в стенде: без неё
 * нечего проверить ни простановку requestId, ни автозакрытие заявки бронью.
 * Отправление — это t-tp-past-1 (Вологда → Череповец, день −6).
 */
const FULFILLED_REQUEST_LINK = {
  requestId: "rr-tp-4",
  bookingId: "b-tp-past-1-bezz",
  tripDepartureAt: days(-6, 9),
} as const;


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
const ALL_RIDE_REQUESTS = [
  "rr-tp-1",
  "rr-tp-2",
  "rr-tp-3",
  "rr-tp-4",
  "rr-tp-5",
];

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
  await prisma.rideRequest.deleteMany({ where: { id: { in: ALL_RIDE_REQUESTS } } });
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
// ── Заявки на попутку реального пользователя ──
// Идут ДО поездок: брони создаются вложенно в trip.create и ссылаются на
// заявку через Booking.requestId, поэтому заявка должна существовать раньше
// (иначе FK Booking_requestId_fkey). Зависят только от городов и юзера.
  // Страница «История запросов» (/profile/ride-requests) показывает список
  // по createdAt desc, поэтому createdAt лестницей — иначе порядок в списке
  // не совпал бы с «свежие сверху».
  //
  // Статусы подобраны так, чтобы покрыть и пилюли, и наборы кнопок:
  // active/paused — с действиями (пауза/возобновление, правка, отмена),
  // fulfilled/expired/cancelled — терминальные, без действий. Сроки в
  // будущем у «живых» — иначе воркер проэкспайрит их в expired.
  const REQUESTS = [
      {
        // expired, а не active: у пользователя было ровно три живые заявки
        // (2 active + 1 paused), то есть ровно MAX_ACTIVE_REQUESTS, и любая
        // публикация возвращала 409 — предотправочное предупреждение было бы
        // нечем завершить. Статус expired заодно закрывает пробел покрытия.
        // Прод-сид не затирает данные, но срок в прошлом обязателен: иначе
        // строка называется «просрочена» при expiresAt в будущем.
        id: "rr-tp-1",
        userId: USER_ID,
        fromCityId: vologda,
        toCityId: cherepovets,
        earliestAt: days(-2, 8),
        latestAt: days(-2, 20),
        seats: 2,
        status: "expired",
        expiresAt: days(-2, 20),
        createdAt: new Date(now.getTime() - 3 * dayMs),
      },
      {
        id: "rr-tp-2",
        userId: USER_ID,
        fromCityId: vologda,
        toCityId: cherepovets,
        earliestAt: days(3, 7),
        latestAt: days(3, 19),
        seats: 1,
        status: "active",
        expiresAt: days(3, 19),
        createdAt: new Date(now.getTime() - dayMs),
      },
      {
        id: "rr-tp-3",
        userId: USER_ID,
        fromCityId: cherepovets,
        toCityId: vologda,
        earliestAt: days(4, 17),
        latestAt: days(4, 22),
        seats: 1,
        status: "paused",
        expiresAt: days(4, 22),
        createdAt: new Date(now.getTime() - 2 * dayMs),
      },
      {
        // fulfilled = закрыта состоявшейся бронью. Окно нарочно шире самой
        // поездки t-tp-past-1 (день −6): связка «заявка → бронь» проверяется
        // тем же предикатом, что и автозакрытие, и не накрывала поездку.
        id: "rr-tp-4",
        userId: USER_ID,
        fromCityId: vologda,
        toCityId: cherepovets,
        earliestAt: days(-7, 9),
        latestAt: days(-5, 18),
        seats: 2,
        status: "fulfilled",
        expiresAt: days(-5, 18),
        createdAt: new Date(now.getTime() - 8 * dayMs),
      },
      {
        id: "rr-tp-5",
        userId: USER_ID,
        fromCityId: cherepovets,
        toCityId: vologda,
        earliestAt: days(-9, 10),
        latestAt: days(-8, 19),
        seats: 1,
        status: "cancelled",
        expiresAt: days(-8, 19),
        createdAt: new Date(now.getTime() - 10 * dayMs),
      },
  ];

  validateUserTripSeed({ requests: REQUESTS });
  await prisma.rideRequest.createMany({ data: REQUESTS });


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
            // Бронь выросла из заявки rr-tp-4 (тот же маршрут, окно накрывает
            // отправление): requestId проставляет рантайм в одной транзакции с
            // закрытием заявки. Без него связку «заявка → поездка» на
            // прод-стенде нечего проверить.
            requestId: "rr-tp-4",
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
  //
  // Заголовки сохраняют префикс «Bezz-тест»: по нему идёт чистка прошлого
  // прогона (deleteMany по title contains), без него повторный запуск оставил
  // бы старые строки. Тексты дальше — по рантайм-шаблонам (bookings/create.ts,
  // bookings/status.ts, trips/index.ts, rideRequests/index.ts), иначе прод-сид
  // проверял бы формулировки, которых в проде нет.
  //
  // Получатель здесь — ПАССАЖИР, поэтому водительских типов (booking_created)
  // здесь быть не может: рантайм шлёт их владельцу поездки, а не пассажиру.
  // Все строки пассажирские, поэтому роль проставлена явно — без неё архив
  // «Водитель/Пассажир» в инбоксе падает в карту типов вместо колонки.
  if (user.notificationsEnabled === false) {
    console.warn(
      "[seed-user-trips] у юзера выключены уведомления: некритичные строки " +
        "рантайм создавать не стал бы (createNotification их отбрасывает). " +
        "Строку User не меняем — только предупреждаем.",
    );
  }
  const NOTIFICATIONS = [
      {
        userId: USER_ID,
        type: "ride_request_match",
        title: "Bezz-тест: Подходящая поездка",
        body: "Нашлась подходящая поездка для вашего запроса. Откройте поездку и отправьте заявку на бронирование.",
        isRead: false,
        deepLink: "/profile/ride-requests",
        actorName: "Илья Северов",
        action: "matched",
        recipientRole: "passenger",
        createdAt: new Date(now.getTime() - hourMs),
      },
      {
        userId: USER_ID,
        type: "booking_status_changed",
        title: "Bezz-тест: Заявка подтверждена",
        body: "Водитель подтвердил вашу заявку в поездке Вологда → Череповец.",
        isRead: false,
        actorName: "Илья Северов",
        action: "confirmed",
        recipientRole: "passenger",
        createdAt: new Date(now.getTime() - 2 * hourMs),
      },
      {
        userId: USER_ID,
        type: "booking_status_changed",
        title: "Bezz-тест: Заявка отклонена",
        body: "Водитель отклонил вашу заявку в поездке Вологда → Череповец.",
        isRead: true,
        actorName: "Илья Северов",
        action: "declined",
        recipientRole: "passenger",
        createdAt: new Date(now.getTime() - 5 * hourMs),
      },
      {
        userId: USER_ID,
        type: "trip_status_changed",
        title: "Bezz-тест: Поездка завершена",
        body: "Поездка Вологда → Череповец завершена. Вы можете оставить отзыв.",
        isRead: false,
        actorName: "Илья Северов",
        action: "completed",
        recipientRole: "passenger",
        createdAt: new Date(now.getTime() - 8 * hourMs),
      },
  ];

  validateUserTripSeed({ notifications: NOTIFICATIONS });
  await prisma.notification.createMany({ data: NOTIFICATIONS });

  // Рейтинг/счётчик по опубликованным — затронутые пользователи.
  for (const userId of [USER_ID, D1, P1]) {
    await refreshRating(userId);
  }

  console.log(
    "[seed-user-trips] ok: 6 поездок (3 свои + 3 чужие), 5 заявок на попутку, " +
      "4 мок-юзера, 6 броней, 4 отзыва, 5 уведомлений",
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
