// backend/prisma/seed.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { MAX_SEATS } from "@edem/contracts";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { seedCityId, seedReportId, seedRideRequestId } from "./seed-ids.js";
import { SEED_CITIES, normalizeCityName } from "./cities-data.js";

// Prisma 7 больше не подгружает .env автоматически — путь относительно файла.
loadEnv({ path: new URL("../.env", import.meta.url) });

if (!process.env.DATABASE_URL) {
  throw new Error("[seed] DATABASE_URL не задан (backend/.env)");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Дефолтный плейсхолдер «нет фото»: inline SVG (data-URI), без внешних CDN.
 * Используется для всех сид-пользователей (совпадает с бэкенд-фолбэком
 * DEFAULT_AVATAR_URL из src/constants.ts).
 */
const DEFAULT_AVATAR_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%23E5E7EB'/%3E%3Ccircle cx='100' cy='75' r='38' fill='%239CA3AF'/%3E%3Cpath d='M30 185c8-40 36-60 70-60s62 20 70 60z' fill='%239CA3AF'/%3E%3C/svg%3E";

interface SeedCar {
  model: string;
  color: string;
  plate: string;
}

interface SeedUser {
  id: string;
  telegramUserId: bigint;
  name: string;
  avatar: string;
  rating: number;
  reviewsCount: number;
  tripsCount: number;
  isVerified: boolean;
  notificationsEnabled?: boolean;
  about?: string;
  car?: SeedCar;
  // Демо админ-флоу: забаненный пользователь (bannedAt + обязательный
  // banReason, как требует рантайм при бане через админку).
  bannedAtDaysAgo?: number;
  banReason?: string;
  // Демо мягкого удаления: пользователь с deletedAt (auth его не пускает).
  deletedAtDaysAgo?: number;
  // Версия показанного онбординга (для проверки reset-флоу в админке).
  onboardingVersion?: string;
  // Демо согласия на TG-уведомления: /start фиксирует tgChatJoinedAt
  // (bot/index.ts). Диспетчер шлёт только при согласии — без него
  // seeded inbox вечно skipped/no_chat и bot-api-send нечем демоить.
  tgChatJoinedAtDaysAgo?: number;
}

interface SeedBooking {
  passengerId: string;
  seat: number;
  status: "pending" | "confirmed" | "declined" | "cancelled";
  comment?: string;
  // Только для cancelled: кто отменил и почему (как пишет рантайм).
  cancelledByType?: "passenger" | "driver";
  cancellationReason?: string;
}

interface SeedTrip {
  id: string;
  driverId: string;
  fromCity: string;
  fromAddress: string;
  toCity: string;
  toAddress: string;
  daysFromNow: number; // отрицательное — в прошлом
  // Целые часы (кратны 60) — как теперь вводит форма создания поездки.
  durationMinutes: number;
  distanceKm: number;
  price: number;
  seatsTotal: number;
  status: "active" | "completed" | "cancelled";
  // Только для cancelled: как пишет рантайм при отмене (трип без
  // cancelledAt в сиде — нереалистичен, валидация требует).
  cancelledAtDaysAgo?: number;
  cancelledByType?: "passenger" | "driver";
  tags: string[];
  comment?: string;
  bookings: SeedBooking[];
}

interface SeedReview {
  id: string;
  authorId: string;
  targetUserId: string;
  targetRole: "passenger" | "driver";
  rating: number;
  text: string;
  tripRoute: string;
  tripId?: string;
  // Статус модерации. По умолчанию "published" — чтобы dev-стенд
  // показывал отзывы (публичный список и рейтинг учитывают только
  // published, см. backend/src/reviews/).
  status?: "pending" | "published" | "rejected";
}

interface SeedRideRequest {
  id: string;
  userId: string;
  fromCity: string;
  toCity: string;
  daysFromNowEarliest: number;
  daysFromNowLatest: number;
  seats?: number;
  status?: "active" | "paused" | "fulfilled" | "expired" | "cancelled";
  // Сколько дней запрос живёт с момента сида (expiresAt = now + N).
  expiresInDays?: number;
}

interface SeedReport {
  id: string;
  reporterId: string;
  targetType: "user" | "trip" | "booking";
  // Ссылка на сид-поездку (для targetType trip/booking резолвится
  // в реальный id поездки/брони) либо произвольный targetId для user.
  tripRef?: string;
  bookingRef?: { tripId: string; passengerId: string };
  targetUserId?: string;
  category: "safety" | "fraud" | "harassment" | "spam" | "inaccurate_info" | "other";
  description: string;
  status?: "pending" | "in_review" | "resolved" | "rejected";
  resolutionNote?: string;
  // Кто рассмотрел (для in_review/resolved/rejected): adminActorType
  // всегда "admin", как проставляет рантайм (reports/index.ts).
  adminActorId?: string;
}

// ─────────────────────────────────────────────────────────────
// Справочник точек — канонический список и нормализация живут в
// ./cities-data.ts (single source, переиспользуется prod-сидом
// seed-cities.ts). Здесь — только dev-логика засевания/реалайнмента.
// ─────────────────────────────────────────────────────────────

/**
 * Засеять/обновить города из канонического списка.
 *
 * Идемпотентно: существующие города НЕ пересоздаются, а только
 * переименовываются (если поменялось имя с тем же nameNormalized).
 * Админские города (вне SEED_CITIES) не трогаются — поиск идёт
 * по nameNormalized, и лишние строки в БД просто остаются.
 *
 * В схеме Prisma `nameNormalized` помечен обычным полем (не
 * `@unique`), потому что Prisma не умеет в `@@unique` поверх
 * выражений. Уникальный индекс на nameNormalized создаётся SQL-
 * миграцией `City_nameNormalized_key`. Здесь используем
 * `findFirst` по нормализованному имени — при наличии дублей
 * (нештатная ситуация) переименуется/обновится первая запись.
 *
 * ВАЖНО: id справочника — детерминированный UUID v5 (seedCityId),
 * а НЕ slug (`city-вологда`) и НЕ рандом. Причины:
 * - `createTripDtoSchema` требует fromCityId/toCityId строго uuid —
 *   slug-id ломали создание поездок через API на свежезасеянной БД
 *   (E2E в CI: POST /trips 400 "Invalid payload"), хотя на старых БД
 *   с uuid-id всё работало;
 * - детерминизм: то же имя → тот же id на каждом прогоне сида
 *   (повторы не плодят дубли и не рвут FK-ссылки сид-поездок).
 *
 * Реалайнмент: если строка существует, но id не детерминированный
 * (наследие сломанного сида со slug-id) — PK переписывается на
 * детерминированный. Это безопасно: main() удаляет ВСЕ строки,
 * ссылающиеся на City (поездки, заявки, брони, отзывы, жалобы),
 * ДО вызова seedCities, а FK Trip/RideRequest — onDelete: SetNull.
 */
async function seedCities(): Promise<void> {
  for (const name of SEED_CITIES) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    const nameNormalized = normalizeCityName(name);
    const deterministicId = seedCityId(nameNormalized);
    // Самопроверка контракта: сид должен падать ГРОМКО здесь, а не
    // тихим 400 в API/E2E (урок инцидента с `city-…` slug-id).
    assertUuid(deterministicId, `seed city «${trimmed}»`);

    const existing = await prisma.city.findFirst({ where: { nameNormalized } });
    if (existing) {
      const patch: { name?: string; id?: string } = {};
      if (existing.name !== trimmed) {
        patch.name = trimmed;
      }
      if (existing.id !== deterministicId) {
        patch.id = deterministicId;
      }
      if (Object.keys(patch).length > 0) {
        await prisma.city.update({
          where: { id: existing.id },
          data: patch,
        });
      }
      continue;
    }

    await prisma.city.create({
      data: {
        id: deterministicId,
        name: trimmed,
        nameNormalized,
      },
    });
  }
}

/**
 * Строгая проверка UUID-формата для сид-id, пересекающих валидируемые
 * контракты. Бросает ДО записи в БД — сид падает громко и понятно.
 */
function assertUuid(value: string, what: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`[seed] ${what} — невалидный UUID: ${value}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Пользователи
// ─────────────────────────────────────────────────────────────
const users: SeedUser[] = [
  // Водители
  {
    id: "u-1",
    telegramUserId: 100001n,
    name: "Илья Северов",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.9,
    reviewsCount: 34,
    tripsCount: 58,
    isVerified: true,

    about: "За рулём 7 лет. Регулярно езжу между Москвой и СПб.",
    car: { model: "Skoda Octavia", color: "белый", plate: "А 217 МК 78" },
  },
  {
    id: "u-2",
    telegramUserId: 100002n,
    name: "Марина Ковалёва",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.8,
    reviewsCount: 21,
    tripsCount: 40,
    isVerified: true,

    about: "Люблю комфортные спокойные поездки.",
    car: { model: "Kia Rio", color: "синий", plate: "В 804 ТР 777" },
  },
  {
    id: "u-3",
    telegramUserId: 100003n,
    name: "Алексей Громов",
    avatar: DEFAULT_AVATAR_URL,
    rating: 5.0,
    reviewsCount: 15,
    tripsCount: 22,
    tgChatJoinedAtDaysAgo: 2,
    isVerified: true,

    about: "Езжу аккуратно, в машине есть кондиционер и хорошая музыка.",
    car: { model: "Volkswagen Tiguan", color: "чёрный", plate: "Е 991 ЕЕ 199" },
  },
  {
    id: "u-5",
    telegramUserId: 100005n,
    name: "Дмитрий Соколов",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.7,
    reviewsCount: 12,
    tripsCount: 30,
    isVerified: true,

    about: "Командировки по области, беру максимум 2 попутчиков.",
    car: { model: "Toyota Camry", color: "серебристый", plate: "М 342 КХ 77" },
  },
  {
    id: "u-6",
    telegramUserId: 100006n,
    name: "Ольга Павлова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.9,
    reviewsCount: 8,
    tripsCount: 16,
    isVerified: true,

    about: "Аккуратная езда, в машине всегда чисто. Только некурящие.",
    car: { model: "Hyundai Solaris", color: "красный", plate: "К 156 РУ 178" },
  },
  {
    id: "u-7",
    telegramUserId: 100007n,
    name: "Сергей Орлов",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.6,
    reviewsCount: 5,
    tripsCount: 12,
    isVerified: true,
    about: "Езжу по выходным за город, могу подбросить.",
    car: { model: "Renault Duster", color: "серый", plate: "С 803 СС 78" },
  },
  {
    id: "u-8",
    telegramUserId: 100008n,
    name: "Анна Волкова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 5.0,
    reviewsCount: 27,
    tripsCount: 45,
    isVerified: true,

    about: "Люблю дальние поездки с приятной беседой.",
    car: { model: "Mazda CX-5", color: "голубой", plate: "Т 618 ВА 77" },
  },
  {
    id: "u-9",
    telegramUserId: 100009n,
    name: "Николай Зайцев",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.5,
    reviewsCount: 3,
    tripsCount: 8,
    isVerified: true,
    about: "Новичок в сервисе, езжу по выходным.",
    car: { model: "Lada Vesta", color: "белый", plate: "Х 455 УК 190" },
  },
  {
    id: "u-10",
    telegramUserId: 100010n,
    name: "Виктор Морозов",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.8,
    reviewsCount: 19,
    tripsCount: 33,
    isVerified: true,

    about: "Пунктуальный, выезжаю строго вовремя.",
    car: { model: "BMW 320i", color: "чёрный", plate: "О 912 ОК 77" },
  },
  {
    id: "u-11",
    telegramUserId: 100011n,
    name: "Татьяна Белова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.9,
    reviewsCount: 11,
    tripsCount: 25,
    isVerified: true,

    about: "Езжу в Тарногский Городок к родителям каждую неделю.",
    car: { model: "Kia Sportage", color: "белый", plate: "А 777 АА 77" },
  },
  {
    id: "u-12",
    telegramUserId: 100012n,
    name: "Андрей Лебедев",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.7,
    reviewsCount: 6,
    tripsCount: 14,
    isVerified: true,
    about: "Документы на проверке, но езжу аккуратно.",
    car: { model: "Skoda Rapid", color: "зелёный", plate: "Р 234 РМ 78" },
  },
  {
    id: "u-13",
    telegramUserId: 100013n,
    name: "Ирина Козлова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.8,
    reviewsCount: 9,
    tripsCount: 18,
    isVerified: true,

    about: "Только с детским креслом при необходимости, по запросу.",
    car: { model: "Nissan Qashqai", color: "коричневый", plate: "У 567 НК 78" },
  },
  // Пассажиры
  {
    id: "u-4",
    telegramUserId: 100004n,
    name: "Елена Смирнова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.7,
    reviewsCount: 9,
    tripsCount: 14,
    tgChatJoinedAtDaysAgo: 3,
    isVerified: true,
    about: "Пассажир, часто езжу по делам в соседние города.",
  },
  {
    id: "u-14",
    telegramUserId: 100014n,
    name: "Павел Никитин",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.6,
    reviewsCount: 4,
    tripsCount: 10,
    onboardingVersion: "1",
    isVerified: true,
    about: "Студент, езжу домой на выходные.",
  },
  {
    id: "u-15",
    telegramUserId: 100015n,
    name: "Наталья Фёдорова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 5.0,
    reviewsCount: 16,
    tripsCount: 21,
    tgChatJoinedAtDaysAgo: 2,
    isVerified: true,

    about: "Пунктуальная, люблю тишину в дороге.",
  },
  {
    id: "u-16",
    telegramUserId: 100016n,
    name: "Михаил Тарасов",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.8,
    reviewsCount: 7,
    tripsCount: 13,
    tgChatJoinedAtDaysAgo: 2,
    isVerified: true,
    about: "Работаю вахтой, нужны поездки к поезду.",
  },
  {
    id: "u-17",
    telegramUserId: 100017n,
    name: "Светлана Егорова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.9,
    reviewsCount: 10,
    tripsCount: 17,
    isVerified: true,
    about: "Езжу с дочкой, всегда аккуратно с временем.",
  },
  {
    id: "u-18",
    telegramUserId: 100018n,
    name: "Артём Киселёв",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.5,
    reviewsCount: 2,
    tripsCount: 5,
    isVerified: true,
    notificationsEnabled: false,
    about: "Спортсмен, иногда с большой сумкой.",
  },
  {
    id: "u-19",
    telegramUserId: 100019n,
    name: "Дарья Петрова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.8,
    reviewsCount: 13,
    tripsCount: 20,
    isVerified: true,

    about: "Дизайнер, работаю удалённо, часто в поездках.",
  },
  {
    id: "u-20",
    telegramUserId: 100020n,
    name: "Роман Соловьёв",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.7,
    reviewsCount: 5,
    tripsCount: 9,
    isVerified: true,
    about: "Путешествую по Золотому кольцу.",
  },
  {
    id: "u-21",
    telegramUserId: 100021n,
    name: "Ксения Абрамова",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.9,
    reviewsCount: 8,
    tripsCount: 12,
    isVerified: true,
    about: "Медик, смены в разное время, ценю гибкость.",
  },
  {
    id: "u-22",
    telegramUserId: 100022n,
    name: "Олег Гусев",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.6,
    reviewsCount: 3,
    tripsCount: 7,
    tgChatJoinedAtDaysAgo: 3,
    isVerified: true,
    about: "Езжу к семье по выходным.",
  },
  // Демо админ-флоу бана: забанен 2 дня назад с обязательной причиной.
  {
    id: "u-23",
    telegramUserId: 100023n,
    name: "Игорь Забаненный",
    avatar: DEFAULT_AVATAR_URL,
    rating: 2.1,
    reviewsCount: 1,
    tripsCount: 2,
    isVerified: false,
    about: "Демо-пользователь для проверки бана в админке.",
    bannedAtDaysAgo: 2,
    banReason: "Спам в комментариях к бронированиям (демо-бан для стенда).",
  },
  // Демо мягкого удаления: аккаунт удалён 5 дней назад.
  {
    id: "u-24",
    telegramUserId: 100024n,
    name: "Удалённый Аккаунт",
    avatar: DEFAULT_AVATAR_URL,
    rating: 4.0,
    reviewsCount: 0,
    tripsCount: 0,
    isVerified: false,
    about: "Демо-пользователь для проверки soft-delete в админке.",
    deletedAtDaysAgo: 5,
  },
];

// ─────────────────────────────────────────────────────────────
// Поездки + брони
// ─────────────────────────────────────────────────────────────
const dayMs = 24 * 60 * 60 * 1000;
// Anchor generated dates to the UTC day so repeated runs on the same day
// produce identical logical timestamps while active fixtures remain future.
const now = new Date();
const seedNow = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);

const bookingId = (tripId: string, passengerId: string, seat: number): string =>
  `booking-${tripId}-${passengerId}-${seat}`;

const trips: SeedTrip[] = [
  // ── Прошлые (completed) ──
  {
    id: "t-past-1",
    driverId: "u-1",
    fromCity: "Вологда",
    fromAddress: "Ж/д вокзал",
    toCity: "Череповец",
    toAddress: "Автовокзал",
    daysFromNow: -3,
    durationMinutes: 110,
    distanceKm: 155,
    price: 700,
    seatsTotal: 3,
    status: "completed",
    tags: ["Тихая поездка", "С остановками"],
    comment: "Отличная поездка в Череповец и обратно.",
    bookings: [
      {
        passengerId: "u-4",
        seat: 1,
        status: "confirmed",
        comment: "Спасибо за поездку!",
      },
      { passengerId: "u-15", seat: 2, status: "confirmed" },
      // Демо отмены пассажиром: место освободилось (partial unique
      // не покрывает cancelled — повторная подача разрешена).
      {
        passengerId: "u-20",
        seat: 3,
        status: "cancelled",
        cancelledByType: "passenger",
        cancellationReason: "Поменялись планы, поеду в другой день.",
      },
    ],
  },
  {
    id: "t-past-2",
    driverId: "u-2",
    fromCity: "Вологда",
    fromAddress: "Октябрьская набережная",
    toCity: "Великий Устюг",
    toAddress: "Автовокзал",
    daysFromNow: -5,
    durationMinutes: 140,
    distanceKm: 155,
    price: 700,
    seatsTotal: 3,
    status: "completed",
    tags: ["Можно с животными", "Есть багаж"],
    bookings: [
      {
        passengerId: "u-4",
        seat: 2,
        status: "confirmed",
        comment: "Прекрасная поездка!",
      },
    ],
  },
  {
    id: "t-past-3",
    driverId: "u-8",
    fromCity: "Череповец",
    fromAddress: "Автовокзал",
    toCity: "Тарногский Городок",
    toAddress: "Ж/д вокзал",
    daysFromNow: -7,
    durationMinutes: 190,
    distanceKm: 215,
    price: 950,
    seatsTotal: 3,
    status: "completed",
    tags: ["Есть багаж", "Разговорчивый"],
    bookings: [
      {
        passengerId: "u-19",
        seat: 1,
        status: "confirmed",
        comment: "Всё отлично!",
      },
      { passengerId: "u-20", seat: 3, status: "confirmed" },
      { passengerId: "u-21", seat: 2, status: "confirmed" },
    ],
  },
  {
    id: "t-past-4",
    driverId: "u-10",
    fromCity: "Вологда",
    fromAddress: "Ж/д вокзал",
    toCity: "Тарногский Городок",
    toAddress: "Центр",
    daysFromNow: -10,
    durationMinutes: 210,
    distanceKm: 245,
    price: 1100,
    seatsTotal: 3,
    status: "completed",
    tags: ["Тихая поездка"],
    bookings: [
      {
        passengerId: "u-16",
        seat: 1,
        status: "confirmed",
        comment: "Спасибо!",
      },
    ],
  },
  {
    id: "t-past-5",
    driverId: "u-11",
    fromCity: "Вытегра",
    fromAddress: "Ж/д вокзал",
    toCity: "Тарногский Городок",
    toAddress: "Ж/д вокзал",
    daysFromNow: -14,
    durationMinutes: 160,
    distanceKm: 170,
    price: 750,
    seatsTotal: 3,
    status: "completed",
    tags: ["С остановками", "Есть багаж"],
    bookings: [
      { passengerId: "u-22", seat: 1, status: "confirmed" },
      {
        passengerId: "u-17",
        seat: 2,
        status: "confirmed",
        comment: "Доехали отлично",
      },
    ],
  },
  // ── Будущие (active) ──
  {
    id: "t-1",
    driverId: "u-1",
    fromCity: "Вологда",
    fromAddress: "Автовокзал",
    toCity: "Череповец",
    toAddress: "Октябрьский проспект",
    daysFromNow: 3,
    durationMinutes: 110,
    distanceKm: 155,
    price: 700,
    seatsTotal: 3,
    status: "active",
    tags: ["Есть багаж", "Тихая поездка"],
    comment: "Останавливаюсь один раз на заправке. В машине не курят.",
    bookings: [
      {
        passengerId: "u-3",
        seat: 1,
        status: "confirmed",
        comment: "Буду с рюкзаком.",
      },
      {
        passengerId: "u-18",
        seat: 2,
        status: "pending",
        comment: "Возьмёте сумку 25 кг?",
      },
    ],
  },
  {
    id: "t-2",
    driverId: "u-2",
    fromCity: "Вологда",
    fromAddress: "Площадь Ленина",
    toCity: "Кадуй",
    toAddress: "Ж/д вокзал",
    daysFromNow: 5,
    durationMinutes: 85,
    distanceKm: 100,
    price: 450,
    seatsTotal: 3,
    status: "active",
    tags: ["Можно с животными", "Есть багаж"],
    comment: "Еду с небольшой собачкой в переноске.",
    bookings: [
      {
        passengerId: "u-4",
        seat: 2,
        status: "pending",
        comment: "Возьмете небольшую сумку?",
      },
    ],
  },
  {
    id: "t-3",
    driverId: "u-3",
    fromCity: "Череповец",
    fromAddress: "Октябрьский проспект",
    toCity: "Вологда",
    toAddress: "Ж/д вокзал",
    daysFromNow: 2,
    durationMinutes: 110,
    distanceKm: 155,
    price: 700,
    seatsTotal: 3,
    status: "active",
    tags: ["Только девушки", "С остановками"],
    comment: "Комфортный кроссовер, климат-контроль.",
    bookings: [
      {
        passengerId: "u-2",
        seat: 1,
        status: "confirmed",
        comment: "Отлично, едем!",
      },
      { passengerId: "u-14", seat: 2, status: "confirmed" },
    ],
  },
  {
    id: "t-4",
    driverId: "u-5",
    fromCity: "Вологда",
    fromAddress: "ул. Мировая",
    toCity: "Грязовец",
    toAddress: "Центр",
    daysFromNow: 1,
    durationMinutes: 60,
    distanceKm: 70,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Тихая поездка"],
    comment: "Выезжаю утром, успеваю к обеду.",
    bookings: [
      {
        passengerId: "u-16",
        seat: 1,
        status: "confirmed",
        comment: "Буду вовремя",
      },
      { passengerId: "u-19", seat: 2, status: "pending" },
    ],
  },
  {
    id: "t-5",
    driverId: "u-6",
    fromCity: "Вологда",
    fromAddress: "Ж/д вокзал",
    toCity: "Великий Устюг",
    toAddress: "Кузьмин монастырь",
    daysFromNow: 4,
    durationMinutes: 140,
    distanceKm: 155,
    price: 700,
    seatsTotal: 3,
    status: "active",
    tags: ["Не курить", "Тихая поездка"],
    bookings: [{ passengerId: "u-21", seat: 1, status: "confirmed" }],
  },
  {
    id: "t-6",
    driverId: "u-8",
    fromCity: "Тарногский Городок",
    fromAddress: "Ж/д вокзал",
    toCity: "Вологда",
    toAddress: "Автовокзал",
    daysFromNow: 6,
    durationMinutes: 210,
    distanceKm: 245,
    price: 1100,
    seatsTotal: 3,
    status: "active",
    tags: ["Есть багаж", "Разговорчивый"],
    comment: "Выезжаю после обеда.",
    bookings: [
      { passengerId: "u-20", seat: 1, status: "pending" },
      { passengerId: "u-15", seat: 3, status: "pending" },
    ],
  },
  {
    id: "t-7",
    driverId: "u-10",
    fromCity: "Череповец",
    fromAddress: "Автовокзал",
    toCity: "Вытегра",
    toAddress: "Ж/д вокзал",
    daysFromNow: 8,
    durationMinutes: 35,
    distanceKm: 35,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Тихая поездка"],
    bookings: [
      {
        passengerId: "u-14",
        seat: 1,
        status: "confirmed",
        comment: "Еду на поезд",
      },
      { passengerId: "u-18", seat: 2, status: "declined" },
    ],
  },
  {
    id: "t-8",
    driverId: "u-11",
    fromCity: "Кадуй",
    fromAddress: "Центр",
    toCity: "Тарногский Городок",
    toAddress: "Ж/д вокзал",
    daysFromNow: 10,
    durationMinutes: 140,
    distanceKm: 150,
    price: 700,
    seatsTotal: 3,
    status: "active",
    tags: ["С остановками", "Есть багаж"],
    comment: "Поеду по М-8 и региональной трассе, комфортный темп.",
    bookings: [
      { passengerId: "u-22", seat: 1, status: "confirmed" },
      { passengerId: "u-4", seat: 2, status: "confirmed", comment: "Жду!" },
    ],
  },
  {
    id: "t-9",
    driverId: "u-13",
    fromCity: "Вологда",
    fromAddress: "ул. Мировая",
    toCity: "Чагода",
    toAddress: "Центр",
    daysFromNow: 3,
    durationMinutes: 50,
    distanceKm: 55,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Можно с детьми"],
    comment: "Поездка на выходные, свободно 3 места.",
    bookings: [],
  },
  {
    id: "t-10",
    driverId: "u-7",
    fromCity: "Вологда",
    fromAddress: "Автовокзал",
    toCity: "Вохтога",
    toAddress: "Центр",
    daysFromNow: 7,
    durationMinutes: 120,
    distanceKm: 130,
    price: 600,
    seatsTotal: 3,
    status: "active",
    tags: ["С остановками"],
    comment: "Выезжаю в пятницу вечером.",
    bookings: [
      {
        passengerId: "u-17",
        seat: 1,
        status: "pending",
        comment: "Можно с ребёнком?",
      },
    ],
  },
  {
    id: "t-11",
    driverId: "u-12",
    fromCity: "Череповец",
    fromAddress: "Центр",
    toCity: "Шексна",
    toAddress: "Автовокзал",
    daysFromNow: 2,
    durationMinutes: 25,
    distanceKm: 20,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Тихая поездка"],
    bookings: [{ passengerId: "u-16", seat: 1, status: "confirmed" }],
  },
  {
    id: "t-12",
    driverId: "u-1",
    fromCity: "Вологда",
    fromAddress: "Ж/д вокзал",
    toCity: "Череповец",
    toAddress: "Автовокзал",
    daysFromNow: 9,
    durationMinutes: 110,
    distanceKm: 155,
    price: 700,
    seatsTotal: 3,
    status: "active",
    tags: ["Есть багаж"],
    comment: "Обычный рейс по субботам.",
    bookings: [],
  },
  {
    id: "t-13",
    driverId: "u-2",
    fromCity: "Кириллов",
    fromAddress: "Кирилло-Белозерский монастырь",
    toCity: "Бабаево",
    toAddress: "Ж/д вокзал",
    daysFromNow: 12,
    durationMinutes: 55,
    distanceKm: 60,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Можно с животными"],
    bookings: [
      { passengerId: "u-15", seat: 1, status: "confirmed" },
      { passengerId: "u-20", seat: 2, status: "pending" },
    ],
  },
  {
    id: "t-14",
    driverId: "u-5",
    fromCity: "Вытегра",
    fromAddress: "Центр",
    toCity: "Череповец",
    toAddress: "Автовокзал",
    daysFromNow: 11,
    durationMinutes: 35,
    distanceKm: 35,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Тихая поездка", "Не курить"],
    bookings: [],
  },
  {
    id: "t-15",
    driverId: "u-6",
    fromCity: "Белозерск",
    fromAddress: "Автовокзал",
    toCity: "Череповец",
    toAddress: "Октябрьский проспект",
    daysFromNow: 5,
    durationMinutes: 95,
    distanceKm: 110,
    price: 500,
    seatsTotal: 3,
    status: "active",
    tags: ["Не курить"],
    bookings: [
      { passengerId: "u-21", seat: 1, status: "confirmed" },
      { passengerId: "u-18", seat: 2, status: "confirmed" },
    ],
  },
  {
    id: "t-16",
    driverId: "u-8",
    fromCity: "Чагода",
    fromAddress: "ул. Ленина",
    toCity: "Вологда",
    toAddress: "Автовокзал",
    daysFromNow: 15,
    durationMinutes: 50,
    distanceKm: 55,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Разговорчивый", "Есть багаж"],
    bookings: [
      {
        passengerId: "u-19",
        seat: 1,
        status: "confirmed",
        comment: "С нетерпением жду!",
      },
    ],
  },
  {
    id: "t-17",
    driverId: "u-10",
    fromCity: "Сокол",
    fromAddress: "Ж/д вокзал",
    toCity: "Грязовец",
    toAddress: "Центр",
    daysFromNow: 13,
    durationMinutes: 45,
    distanceKm: 50,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["Тихая поездка"],
    bookings: [],
  },
  {
    id: "t-18",
    driverId: "u-11",
    fromCity: "Верховажье",
    fromAddress: "Центр",
    toCity: "Вологда",
    toAddress: "Ж/д вокзал",
    daysFromNow: 16,
    durationMinutes: 90,
    distanceKm: 95,
    price: 450,
    seatsTotal: 3,
    status: "active",
    tags: ["С остановками"],
    bookings: [{ passengerId: "u-22", seat: 1, status: "pending" }],
  },
  {
    id: "t-19",
    driverId: "u-13",
    fromCity: "Молочное",
    fromAddress: "Центр",
    toCity: "Вологда",
    toAddress: "Автовокзал",
    daysFromNow: 17,
    durationMinutes: 70,
    distanceKm: 80,
    price: 350,
    seatsTotal: 3,
    status: "active",
    tags: ["Можно с детьми"],
    bookings: [{ passengerId: "u-17", seat: 1, status: "confirmed" }],
  },
  {
    id: "t-20",
    driverId: "u-7",
    fromCity: "Никольск",
    fromAddress: "Центр",
    toCity: "Бабаево",
    toAddress: "Ж/д вокзал",
    daysFromNow: 20,
    durationMinutes: 60,
    distanceKm: 65,
    price: 300,
    seatsTotal: 3,
    status: "active",
    tags: ["С остановками"],
    bookings: [],
  },
  {
    id: "t-21",
    driverId: "u-12",
    fromCity: "Кичменгский Городок",
    fromAddress: "Ж/д вокзал",
    toCity: "Череповец",
    toAddress: "Автовокзал",
    daysFromNow: 18,
    durationMinutes: 90,
    distanceKm: 110,
    price: 500,
    seatsTotal: 3,
    status: "active",
    tags: ["Тихая поездка"],
    bookings: [
      { passengerId: "u-14", seat: 1, status: "pending" },
      { passengerId: "u-16", seat: 2, status: "confirmed" },
    ],
  },
  // ── Прошлые (completed) — свежие, под новые отзывы ──
  {
    id: "t-past-6",
    driverId: "u-3",
    fromCity: "Вологда",
    fromAddress: "Автовокзал",
    toCity: "Сокол",
    toAddress: "Ж/д вокзал",
    daysFromNow: -2,
    durationMinutes: 55,
    distanceKm: 60,
    price: 350,
    seatsTotal: 3,
    status: "completed",
    tags: ["Тихая поездка", "Есть багаж"],
    comment: "Съездили отлично, дорога сухая.",
    bookings: [
      { passengerId: "u-14", seat: 1, status: "confirmed" },
      { passengerId: "u-18", seat: 2, status: "confirmed" },
      { passengerId: "u-16", seat: 3, status: "confirmed" },
    ],
  },
  {
    id: "t-past-7",
    driverId: "u-5",
    fromCity: "Грязовец",
    fromAddress: "Центр",
    toCity: "Вологда",
    toAddress: "Автовокзал",
    daysFromNow: -1,
    durationMinutes: 60,
    distanceKm: 70,
    price: 300,
    seatsTotal: 3,
    status: "completed",
    tags: ["С остановками"],
    bookings: [
      { passengerId: "u-19", seat: 1, status: "confirmed" },
      { passengerId: "u-20", seat: 2, status: "confirmed" },
    ],
  },
  // ── Отменённые (cancelled) ──
  {
    id: "t-c-1",
    driverId: "u-3",
    fromCity: "Федотово",
    fromAddress: "Ж/д вокзал",
    toCity: "Вологда",
    toAddress: "Автовокзал",
    daysFromNow: -1,
    durationMinutes: 45,
    distanceKm: 50,
    price: 300,
    seatsTotal: 3,
    status: "cancelled",
    cancelledAtDaysAgo: 1,
    cancelledByType: "driver",
    tags: ["С остановками"],
    comment: "Поездка отменена из-за погоды.",
    bookings: [{ passengerId: "u-15", seat: 1, status: "declined" }],
  },
  {
    id: "t-c-2",
    driverId: "u-5",
    fromCity: "Суда",
    fromAddress: "Центр",
    toCity: "Череповец",
    toAddress: "Площадь Гагарина",
    daysFromNow: 4,
    durationMinutes: 115,
    distanceKm: 130,
    price: 600,
    seatsTotal: 3,
    status: "cancelled",
    cancelledAtDaysAgo: 1,
    cancelledByType: "driver",
    tags: [],
    comment: "Отменил, планы изменились.",
    bookings: [],
  },
];

// ─────────────────────────────────────────────────────────────
// Отзывы
// ─────────────────────────────────────────────────────────────
const reviews: SeedReview[] = [
  {
    id: "r-1",
    authorId: "u-15",
    targetUserId: "u-1",
    targetRole: "driver",
    rating: 5,
    text: "Отличный водитель, доехали комфортно и точно в срок!",
    tripRoute: "Вологда → Череповец",
    tripId: "t-past-1",
  },
  {
    id: "r-2",
    authorId: "u-4",
    targetUserId: "u-2",
    targetRole: "driver",
    rating: 5,
    text: "Прекрасная поездка, очень приятный водитель.",
    tripRoute: "Вологда → Великий Устюг",
    tripId: "t-past-2",
  },
  {
    id: "r-3",
    authorId: "u-19",
    targetUserId: "u-8",
    targetRole: "driver",
    rating: 5,
    text: "Анна — супер! Машина чистая, ехали быстро и безопасно.",
    tripRoute: "Череповец → Тарногский Городок",
    tripId: "t-past-3",
  },
  {
    id: "r-4",
    authorId: "u-16",
    targetUserId: "u-10",
    targetRole: "driver",
    rating: 5,
    text: "Пунктуальный, выехали минута в минуту.",
    tripRoute: "Вологда → Тарногский Городок",
    tripId: "t-past-4",
  },
  {
    id: "r-5",
    authorId: "u-22",
    targetUserId: "u-11",
    targetRole: "driver",
    rating: 4,
    text: "Хорошая поездка, единственное — одна остановка лишняя.",
    tripRoute: "Вытегра → Тарногский Городок",
    tripId: "t-past-5",
  },
  {
    id: "r-6",
    authorId: "u-1",
    targetUserId: "u-4",
    targetRole: "passenger",
    rating: 5,
    text: "Елена — идеальный пассажир, вовремя и без проблем.",
    tripRoute: "Вологда → Череповец",
    tripId: "t-past-1",
  },
  {
    id: "r-7",
    authorId: "u-8",
    targetUserId: "u-19",
    targetRole: "passenger",
    rating: 5,
    text: "Дарья очень приятная, надеюсь увидимся ещё.",
    tripRoute: "Череповец → Тарногский Городок",
    tripId: "t-past-3",
  },
  {
    id: "r-8",
    authorId: "u-8",
    targetUserId: "u-20",
    targetRole: "passenger",
    rating: 4,
    text: "Хороший пассажир, немного опоздал на встречу.",
    tripRoute: "Череповец → Тарногский Городок",
    tripId: "t-past-3",
  },
  {
    id: "r-9",
    authorId: "u-11",
    targetUserId: "u-17",
    targetRole: "passenger",
    rating: 5,
    text: "Светлана с дочкой — очень воспитанные попутчики.",
    tripRoute: "Вытегра → Тарногский Городок",
    tripId: "t-past-5",
  },
  {
    id: "r-10",
    authorId: "u-2",
    targetUserId: "u-4",
    targetRole: "passenger",
    rating: 5,
    text: "Наталья — тихая и аккуратная, рекомендую.",
    tripRoute: "Вологда → Великий Устюг",
    tripId: "t-past-2",
  },
  {
    id: "r-11",
    authorId: "u-1",
    targetUserId: "u-15",
    targetRole: "passenger",
    rating: 5,
    text: "Приятный собеседник, в пути было интересно.",
    tripRoute: "Вологда → Череповец",
    tripId: "t-past-1",
  },
  {
    id: "r-12",
    authorId: "u-10",
    targetUserId: "u-16",
    targetRole: "passenger",
    rating: 4,
    text: "Нормальный пассажир, был с большой сумкой.",
    tripRoute: "Вологда → Тарногский Городок",
    tripId: "t-past-4",
  },
  {
    id: "r-13",
    authorId: "u-4",
    targetUserId: "u-1",
    targetRole: "driver",
    rating: 5,
    text: "Илья водит очень плавно, дорога пролетела незаметно.",
    tripRoute: "Вологда → Череповец",
    tripId: "t-past-1",
  },
  {
    id: "r-14",
    authorId: "u-20",
    targetUserId: "u-8",
    targetRole: "driver",
    rating: 5,
    text: "Отличная машина, водитель профессионал.",
    tripRoute: "Череповец → Тарногский Городок",
    tripId: "t-past-3",
  },
  {
    id: "r-15",
    authorId: "u-21",
    targetUserId: "u-8",
    targetRole: "driver",
    rating: 5,
    text: "Чудесная поездка, спасибо за компанию!",
    tripRoute: "Череповец → Тарногский Городок",
    tripId: "t-past-3",
  },
  {
    id: "r-16",
    authorId: "u-17",
    targetUserId: "u-11",
    targetRole: "driver",
    rating: 5,
    text: "Татьяна — очень аккуратная, с детьми особенно ценно.",
    tripRoute: "Вытегра → Тарногский Городок",
    tripId: "t-past-5",
  },
  {
    id: "r-17",
    authorId: "u-8",
    targetUserId: "u-21",
    targetRole: "passenger",
    rating: 5,
    text: "Ксения — пунктуальный и приятный пассажир.",
    tripRoute: "Череповец → Тарногский Городок",
    tripId: "t-past-3",
  },
  {
    id: "r-18",
    authorId: "u-11",
    targetUserId: "u-22",
    targetRole: "passenger",
    rating: 5,
    text: "Олег приехал вовремя и аккуратно относился к машине.",
    tripRoute: "Вытегра → Тарногский Городок",
    tripId: "t-past-5",
  },
  // ── Новые: t-past-6 (Вологда → Сокол) ──
  {
    id: "r-19",
    authorId: "u-14",
    targetUserId: "u-3",
    targetRole: "driver",
    rating: 5,
    status: "published",
    text: "Алексей — отличный водитель! Ехали плавно, всю дорогу интересный разговор.",
    tripRoute: "Вологда → Сокол",
    tripId: "t-past-6",
  },
  {
    id: "r-20",
    authorId: "u-18",
    targetUserId: "u-3",
    targetRole: "driver",
    rating: 4,
    status: "published",
    text: "Всё хорошо, только выехали минут на десять позже запланированного.",
    tripRoute: "Вологда → Сокол",
    tripId: "t-past-6",
  },
  {
    id: "r-21",
    authorId: "u-3",
    targetUserId: "u-14",
    targetRole: "passenger",
    rating: 5,
    status: "published",
    text: "Павел — пунктуальный и вежливый, берите не раздумывая.",
    tripRoute: "Вологда → Сокол",
    tripId: "t-past-6",
  },
  {
    id: "r-22",
    authorId: "u-3",
    targetUserId: "u-18",
    targetRole: "passenger",
    rating: 3,
    status: "published",
    text: "Артём опоздал к месту встречи, но в пути без нареканий.",
    tripRoute: "Вологда → Сокол",
    tripId: "t-past-6",
  },
  {
    id: "r-23",
    authorId: "u-16",
    targetUserId: "u-3",
    targetRole: "driver",
    rating: 4,
    status: "pending",
    text: "Комфортная поездка, водитель вежливый.",
    tripRoute: "Вологда → Сокол",
    tripId: "t-past-6",
  },
  {
    id: "r-24",
    authorId: "u-3",
    targetUserId: "u-16",
    targetRole: "passenger",
    rating: 5,
    status: "published",
    text: "Михаил — спокойный и аккуратный попутчик.",
    tripRoute: "Вологда → Сокол",
    tripId: "t-past-6",
  },
  // ── Новые: t-past-7 (Грязовец → Вологда) ──
  {
    id: "r-25",
    authorId: "u-19",
    targetUserId: "u-5",
    targetRole: "driver",
    rating: 5,
    status: "pending",
    text: "Дмитрий довёз быстро и с комфортом!",
    tripRoute: "Грязовец → Вологда",
    tripId: "t-past-7",
  },
  {
    id: "r-26",
    authorId: "u-20",
    targetUserId: "u-5",
    targetRole: "driver",
    rating: 2,
    status: "rejected",
    text: "Ужасный водитель, больше никогда!!!",
    tripRoute: "Грязовец → Вологда",
    tripId: "t-past-7",
  },
  {
    id: "r-27",
    authorId: "u-5",
    targetUserId: "u-19",
    targetRole: "passenger",
    rating: 5,
    status: "published",
    text: "Дарья — приятная попутчица, всегда вовремя.",
    tripRoute: "Грязовец → Вологда",
    tripId: "t-past-7",
  },
  {
    id: "r-28",
    authorId: "u-5",
    targetUserId: "u-20",
    targetRole: "passenger",
    rating: 4,
    status: "published",
    text: "Роман немного опоздал, в остальном всё отлично.",
    tripRoute: "Грязовец → Вологда",
    tripId: "t-past-7",
  },
];

// ─────────────────────────────────────────────────────────────
// Заявки на поездку (пассажиры ищут попутку)
// ─────────────────────────────────────────────────────────────
const rideRequests: SeedRideRequest[] = [
  {
    id: seedRideRequestId("rr-1"),
    userId: "u-14",
    fromCity: "Вологда",
    toCity: "Череповец",
    daysFromNowEarliest: 1,
    daysFromNowLatest: 2,
    seats: 1,
    status: "active",
    expiresInDays: 7,
  },
  {
    id: seedRideRequestId("rr-2"),
    userId: "u-16",
    fromCity: "Череповец",
    toCity: "Вологда",
    daysFromNowEarliest: 3,
    daysFromNowLatest: 5,
    seats: 2,
    status: "active",
    expiresInDays: 10,
  },
  {
    id: seedRideRequestId("rr-3"),
    userId: "u-18",
    fromCity: "Вологда",
    toCity: "Грязовец",
    daysFromNowEarliest: 1,
    daysFromNowLatest: 1,
    seats: 1,
    status: "paused",
    expiresInDays: 7,
  },
  {
    id: seedRideRequestId("rr-4"),
    userId: "u-21",
    fromCity: "Сокол",
    toCity: "Вологда",
    daysFromNowEarliest: -10,
    daysFromNowLatest: -9,
    seats: 1,
    status: "fulfilled",
    expiresInDays: 1,
  },
  {
    id: seedRideRequestId("rr-5"),
    userId: "u-22",
    fromCity: "Кадуй",
    toCity: "Череповец",
    daysFromNowEarliest: -5,
    daysFromNowLatest: -4,
    seats: 1,
    status: "expired",
    expiresInDays: -1,
  },
];

// ─────────────────────────────────────────────────────────────
// Жалобы (модерация в админке). Тройки (автор, тип, объект) уникальны —
// лимит «1 жалоба навсегда» (@@unique в схеме). Статусы покрывают все
// состояния модерации: pending → in_review → resolved / rejected.
// ─────────────────────────────────────────────────────────────
const reports: SeedReport[] = [
  {
    id: seedReportId("rep-1"),
    reporterId: "u-4",
    targetType: "trip",
    tripRef: "t-past-1",
    category: "safety",
    description: "Водитель резко тормозил и разговаривал по телефону за рулём.",
    status: "pending",
  },
  {
    id: seedReportId("rep-2"),
    reporterId: "u-15",
    targetType: "user",
    targetUserId: "u-1",
    category: "harassment",
    description: "Водитель грубил в переписке перед поездкой.",
    status: "in_review",
    adminActorId: "u-2",
  },
  {
    id: seedReportId("rep-3"),
    reporterId: "u-19",
    targetType: "trip",
    tripRef: "t-past-3",
    category: "inaccurate_info",
    description: "В объявлении было указано другое время отправления.",
    status: "resolved",
    resolutionNote: "Водитель предупреждён, время в объявлении исправлено.",
    adminActorId: "u-2",
  },
  {
    id: seedReportId("rep-4"),
    reporterId: "u-8",
    targetType: "booking",
    bookingRef: { tripId: "t-past-3", passengerId: "u-21" },
    category: "spam",
    description: "Кажется, бронь создана для накрутки счётчика поездок.",
    status: "rejected",
    resolutionNote: "Проверка не подтвердила нарушение: бронь реальная.",
    adminActorId: "u-2",
  },
];

function validateSeedData(): void {
  const userIds = new Set(users.map((user) => user.id));
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  const reviewKeys = new Set<string>();

  for (const trip of trips) {
    if (trip.seatsTotal < 1 || trip.seatsTotal > MAX_SEATS) {
      throw new Error(`Invalid seatsTotal for seed trip ${trip.id}`);
    }

    // Активная поездка не может отправляться в прошлом: поиск скрывает
    // уехавшие (departureAt > now), а воркер автозавершения догоняет их
    // только через 24 часа. Отрицательный daysFromNow допустим лишь для
    // completed/cancelled (история).
    if (trip.status === "active" && trip.daysFromNow <= 0) {
      throw new Error(
        `Active seed trip ${trip.id} departs in the past (daysFromNow=${trip.daysFromNow})`,
      );
    }

    // Отменённая поездка обязана иметь след отмены (как пишет рантайм).
    if (trip.status === "cancelled" && trip.cancelledAtDaysAgo === undefined) {
      throw new Error(`Cancelled seed trip ${trip.id} без cancelledAt`);
    }

    const activeSeats = new Set<number>();
    const activePassengers = new Set<string>();
    for (const booking of trip.bookings) {
      if (!userIds.has(booking.passengerId)) {
        throw new Error(
          `Unknown passenger ${booking.passengerId} in ${trip.id}`,
        );
      }
      if (booking.seat < 1 || booking.seat > trip.seatsTotal) {
        throw new Error(`Invalid seat ${booking.seat} in ${trip.id}`);
      }
      if (booking.status === "pending" || booking.status === "confirmed") {
        if (activeSeats.has(booking.seat)) {
          throw new Error(
            `Duplicate active seat ${booking.seat} in ${trip.id}`,
          );
        }
        if (activePassengers.has(booking.passengerId)) {
          throw new Error(
            `Duplicate active passenger ${booking.passengerId} in ${trip.id}`,
          );
        }
        activeSeats.add(booking.seat);
        activePassengers.add(booking.passengerId);
      }
    }
    const reservedSeats = trip.bookings.filter(
      (booking) => booking.status === "pending" || booking.status === "confirmed",
    ).length;
    if (reservedSeats > trip.seatsTotal) {
      throw new Error(`Too many active bookings in ${trip.id}`);
    }
  }

  for (const review of reviews) {
    if (
      review.status &&
      !["pending", "published", "rejected"].includes(review.status)
    ) {
      throw new Error(`Invalid status in seed review ${review.id}`);
    }
    const trip = review.tripId ? tripById.get(review.tripId) : undefined;
    if (!userIds.has(review.authorId) || !userIds.has(review.targetUserId)) {
      throw new Error(`Unknown user in seed review ${review.id}`);
    }
    if (!trip || review.authorId === review.targetUserId) {
      throw new Error(`Invalid trip or users in seed review ${review.id}`);
    }

    const confirmedPassengers = new Set(
      trip.bookings
        .filter((booking) => booking.status === "confirmed")
        .map((booking) => booking.passengerId),
    );
    const validDirection =
      review.targetRole === "driver"
        ? trip.driverId === review.targetUserId &&
          confirmedPassengers.has(review.authorId)
        : review.authorId === trip.driverId &&
          confirmedPassengers.has(review.targetUserId);
    if (!validDirection) {
      throw new Error(`Invalid review direction in seed review ${review.id}`);
    }

    const key = `${review.authorId}:${review.tripId}:${review.targetUserId}`;
    if (reviewKeys.has(key)) {
      throw new Error(`Duplicate seed review ${key}`);
    }
    reviewKeys.add(key);
  }

  const cityNames = new Set(SEED_CITIES.map(normalizeCityName));
  const deletedUsers = new Set(
    users.filter((u) => u.deletedAtDaysAgo !== undefined).map((u) => u.id),
  );
  const referencedUsers = new Set<string>();
  for (const trip of trips) {
    referencedUsers.add(trip.driverId);
    for (const booking of trip.bookings) {
      referencedUsers.add(booking.passengerId);
      // Отменённая бронь обязана иметь причину (как пишет рантайм).
      if (booking.status === "cancelled" && !booking.cancellationReason) {
        throw new Error(`Cancelled seed booking in ${trip.id} без причины`);
      }
    }
  }
  for (const review of reviews) {
    referencedUsers.add(review.authorId);
    referencedUsers.add(review.targetUserId);
  }
  for (const user of users) {
    // Забаненный обязан иметь причину (рантайм требует 1..500 символов).
    if (user.bannedAtDaysAgo !== undefined && !user.banReason) {
      throw new Error(`Banned seed user ${user.id} без причины`);
    }
  }

  for (const rr of rideRequests) {
    if (!userIds.has(rr.userId) || deletedUsers.has(rr.userId)) {
      throw new Error(`Invalid user in seed ride request ${rr.id}`);
    }
    // id заявки пересекает валидируемый контракт (rideRequestSchema.id —
    // uuid, мини-апп валидирует список): slug-id роняют клиентскую
    // валидацию. Проверяем здесь, а не тихим 400/пустым списком в UI.
    assertUuid(rr.id, `seed ride request «${rr.id}»`);
    referencedUsers.add(rr.userId);
    if (
      !cityNames.has(normalizeCityName(rr.fromCity)) ||
      !cityNames.has(normalizeCityName(rr.toCity))
    ) {
      throw new Error(`Unknown city in seed ride request ${rr.id}`);
    }
    if (normalizeCityName(rr.fromCity) === normalizeCityName(rr.toCity)) {
      throw new Error(`Same from/to city in seed ride request ${rr.id}`);
    }
    if (rr.daysFromNowEarliest > rr.daysFromNowLatest) {
      throw new Error(`Inverted window in seed ride request ${rr.id}`);
    }
    if (rr.seats !== undefined && (rr.seats < 1 || rr.seats > MAX_SEATS)) {
      throw new Error(`Invalid seats in seed ride request ${rr.id}`);
    }
  }

  const reportKeys = new Set<string>();
  for (const report of reports) {
    if (!userIds.has(report.reporterId) || deletedUsers.has(report.reporterId)) {
      throw new Error(`Invalid reporter in seed report ${report.id}`);
    }
    // id жалобы пересекает валидируемый контракт (reportSchema.id — uuid:
    // мини-апп и админка валидируют списки). См. комментарий у rideRequests.
    assertUuid(report.id, `seed report «${report.id}»`);
    referencedUsers.add(report.reporterId);
    if (report.adminActorId) {
      if (!userIds.has(report.adminActorId)) {
        throw new Error(`Unknown admin actor in seed report ${report.id}`);
      }
      referencedUsers.add(report.adminActorId);
    }
    let targetKey: string;
    if (report.targetType === "trip") {
      if (!report.tripRef || !tripById.has(report.tripRef)) {
        throw new Error(`Unknown trip ref in seed report ${report.id}`);
      }
      targetKey = report.tripRef;
    } else if (report.targetType === "booking") {
      const ref = report.bookingRef;
      const trip = ref ? tripById.get(ref.tripId) : undefined;
      if (!trip || !trip.bookings.some((b) => b.passengerId === ref!.passengerId)) {
        throw new Error(`Unknown booking ref in seed report ${report.id}`);
      }
      targetKey = `${ref!.tripId}:${ref!.passengerId}`;
    } else {
      if (!report.targetUserId || !userIds.has(report.targetUserId)) {
        throw new Error(`Unknown target user in seed report ${report.id}`);
      }
      referencedUsers.add(report.targetUserId);
      targetKey = report.targetUserId;
    }
    // Лимит «1 жалоба навсегда»: тройка обязана быть уникальной.
    const triple = `${report.reporterId}:${report.targetType}:${targetKey}`;
    if (reportKeys.has(triple)) {
      throw new Error(`Duplicate seed report ${triple}`);
    }
    reportKeys.add(triple);
    // Рассмотренная жалоба обязана иметь резолюцию и автора рассмотрения.
    if (
      (report.status === "resolved" || report.status === "rejected") &&
      (!report.resolutionNote || !report.adminActorId)
    ) {
      throw new Error(`Terminal seed report ${report.id} без резолюции/автора`);
    }
  }

  for (const city of SEED_CITIES) {
    const normalized = normalizeCityName(city);
    const occurrences = SEED_CITIES.filter(
      (candidate) => normalizeCityName(candidate) === normalized,
    ).length;
    if (occurrences !== 1) {
      throw new Error(`Duplicate seed city ${normalized}`);
    }
  }

  // Удалённый пользователь нигде не должен участвовать (auth его не пустит).
  for (const id of referencedUsers) {
    if (deletedUsers.has(id)) {
      throw new Error(`Deleted seed user ${id} используется в данных`);
    }
  }
}

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_PRODUCTION_SEED !== "true"
  ) {
    throw new Error(
      "Refusing to reset a production database. Set ALLOW_PRODUCTION_SEED=true to override.",
    );
  }

  validateSeedData();
  console.log("Seeding database with rich mock data...");

  // Clean old records
  await prisma.notification.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.report.deleteMany();
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.rideRequest.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.car.deleteMany();
  await prisma.user.deleteMany();

  // Create Users (with cars for drivers)
  for (const u of users) {
    await prisma.user.create({
      data: {
        id: u.id,
        telegramUserId: u.telegramUserId,
        name: u.name,
        avatar: u.avatar,
        rating: u.rating,
        reviewsCount: u.reviewsCount,
        tripsCount: u.tripsCount,
        isVerified: u.isVerified,
        notificationsEnabled: u.notificationsEnabled ?? true,
        verifiedAt: u.isVerified ? new Date(seedNow.getTime() - 60 * dayMs) : null,
        about: u.about,
        bannedAt:
          u.bannedAtDaysAgo !== undefined
            ? new Date(seedNow.getTime() - u.bannedAtDaysAgo * dayMs)
            : null,
        banReason: u.banReason ?? null,
        deletedAt:
          u.deletedAtDaysAgo !== undefined
            ? new Date(seedNow.getTime() - u.deletedAtDaysAgo * dayMs)
            : null,
        onboardingVersion: u.onboardingVersion ?? null,
        tgChatJoinedAt:
          u.tgChatJoinedAtDaysAgo !== undefined
            ? new Date(seedNow.getTime() - u.tgChatJoinedAtDaysAgo * dayMs)
            : null,
        ...(u.car
          ? {
              car: {
                create: u.car,
              },
            }
          : {}),
      },
    });
  }

  // Create Trips + Bookings
  // Справочник городов — раньше поездок: нужны id для FK-линковки
  // fromCityId/toCityId (снимок fromCity/toCity остаётся источником
  // правды для UI, FK — для аналитики и автодополнения).
  await seedCities();
  const cityRows = await prisma.city.findMany({ select: { id: true, nameNormalized: true } });
  const cityIdByName = new Map(cityRows.map((c) => [c.nameNormalized, c.id]));
  const cityId = (name: string): string => {
    const id = cityIdByName.get(normalizeCityName(name));
    if (!id) throw new Error(`[seed] город «${name}» отсутствует в справочнике City`);
    return id;
  };
  for (const t of trips) {
    await prisma.trip.create({
      data: {
        id: t.id,
        driverId: t.driverId,
        fromCity: t.fromCity,
        fromAddress: t.fromAddress,
        toCity: t.toCity,
        toAddress: t.toAddress,
        fromCityId: cityId(t.fromCity),
        toCityId: cityId(t.toCity),
        departureAt: new Date(seedNow.getTime() + t.daysFromNow * dayMs),
        durationMinutes: t.durationMinutes,
        distanceKm: t.distanceKm,
        price: t.price,
        seatsTotal: t.seatsTotal,
        // Pending and confirmed bookings both reserve capacity.
        seatsAvailable:
          t.status === "active"
            ? t.seatsTotal -
              t.bookings.filter(
                (b) => b.status === "pending" || b.status === "confirmed",
              ).length
            : 0,
        status: t.status,
        tags: t.tags,
        comment: t.comment,
        cancelledAt:
          t.status === "cancelled" && t.cancelledAtDaysAgo !== undefined
            ? new Date(seedNow.getTime() - t.cancelledAtDaysAgo * dayMs)
            : null,
        cancelledByType: t.status === "cancelled" ? (t.cancelledByType ?? "driver") : null,
        cancelledByUserId: t.status === "cancelled" ? t.driverId : null,
        cancellationReason: t.status === "cancelled" ? (t.comment ?? null) : null,
        bookings: {
          create: t.bookings.map((b) => ({
            id: bookingId(t.id, b.passengerId, b.seat),
            passengerId: b.passengerId,
            seat: b.seat,
            status: b.status,
            comment: b.comment,
            cancelledAt: b.status === "cancelled" ? seedNow : null,
            cancelledByType:
              b.status === "cancelled" ? (b.cancelledByType ?? "passenger") : null,
            cancelledByUserId:
              b.status === "cancelled"
                ? b.cancelledByType === "driver"
                  ? t.driverId
                  : b.passengerId
                : null,
            cancellationReason: b.cancellationReason ?? null,
          })),
        },
      },
    });
  }

  // Счётчик НЕ отменённых поездок (денормализация для админки:
  // guard удаления города + отображение; меняется только через
  // cities/counters.ts, здесь — прямой пересчёт под сид-данные).
  // Считаем по снимкам fromCity/toCity (источник правды), а не по FK.
  const liveTrips = trips.filter((t) => t.status !== "cancelled");
  for (const city of cityRows) {
    const count = liveTrips.reduce(
      (total, trip) =>
        total +
        (normalizeCityName(trip.fromCity) === city.nameNormalized ? 1 : 0) +
        (normalizeCityName(trip.toCity) === city.nameNormalized ? 1 : 0),
      0,
    );
    await prisma.city.update({ where: { id: city.id }, data: { tripsCount: count } });
  }

  // Create Reviews
  for (const r of reviews) {
    await prisma.review.create({
      data: {
        id: r.id,
        authorId: r.authorId,
        targetUserId: r.targetUserId,
        targetRole: r.targetRole,
        rating: r.rating,
        text: r.text,
        tripRoute: r.tripRoute,
        tripId: r.tripId,
        status: r.status ?? "published",
      },
    });
  }

  // Рейтинг и счётчик — только по опубликованным (как в рантайме:
  // backend/src/reviews/rating.ts). Pending/rejected в рейтинг не входят.
  const reviewAggregates = await prisma.review.groupBy({
    by: ["targetUserId"],
    where: { status: "published" },
    _avg: { rating: true },
    _count: { _all: true },
  });
  for (const aggregate of reviewAggregates) {
    await prisma.user.update({
      where: { id: aggregate.targetUserId },
      data: {
        rating: aggregate._avg.rating ?? 5,
        reviewsCount: aggregate._count._all,
      },
    });
  }

  // Create Notifications
  const notifications = [
    {
      userId: "u-3",
      type: "booking_created",
      title: "Новая заявка на поездку",
      body: "Павел Никитин хочет присоединиться к вашей поездке Череповец → Вологда.",
      isRead: false,
    },
    {
      userId: "u-3",
      type: "booking_created",
      title: "Новая заявка на поездку",
      body: "Артём Киселёв хочет присоединиться к вашей поездке Череповец → Вологда.",
      isRead: false,
    },
    {
      userId: "u-4",
      type: "booking_confirmed",
      title: "Бронирование подтверждено",
      body: "Марина Ковалёва подтвердила вашу поездку Вологда → Великий Устюг.",
      isRead: false,
    },
    {
      userId: "u-18",
      type: "booking_created",
      title: "Новая заявка на поездку",
      body: "Вы отправили заявку на поездку Вологда → Череповец.",
      isRead: true,
    },
    {
      userId: "u-16",
      type: "booking_confirmed",
      title: "Бронирование подтверждено",
      body: "Дмитрий Соколов подтвердил вашу поездку Вологда → Грязовец.",
      isRead: false,
    },
    {
      userId: "u-22",
      type: "booking_confirmed",
      title: "Бронирование подтверждено",
      body: "Татьяна Белова подтвердила вашу поездку Кадуй → Тарногский Городок.",
      isRead: true,
    },
    {
      userId: "u-15",
      type: "trip_cancelled",
      title: "Поездка отменена",
      body: "Алексей Громов отменил поездку Федотово → Вологда.",
      isRead: false,
    },
    {
      userId: "u-4",
      type: "trip_cancelled",
      title: "Поездка отменена",
      body: "Дмитрий Соколов отменил поездку Суда → Череповец.",
      isRead: true,
    },
  ];

// 6 новых типов уведомлений (старый booking_confirmed + 5 новых)
  const newNotifications = [
    {
      userId: "u-18",
      type: "ride_request_match",
      title: "Новый попутчик",
      body: 'Иван Иванов хочет присоединиться к вашей поездке Москва → Казань.',
      isRead: false,
    },
    {
      userId: "u-18",
      type: "trip_details_changed",
      title: "Изменение деталей поездки",
      body: 'Время отправления поездки Череповец → Вологда сдвинуто на 30 минут.',
      isRead: false,
    },
    {
      userId: "u-18",
      type: "booking_status_changed",
      title: "Статус бронирования изменён",
      body: 'Ваша заявка на поездку подтверждена.',
      isRead: false,
    },
    {
      userId: "u-18",
      type: "trip_status_changed",
      title: "Поездка отменена",
      body: 'Ваша поездка отменена.',
      isRead: false,
    },
    {
      userId: "u-18",
      type: "feedback_replied",
      title: "Ответ на обращение в поддержку",
      body: 'На ваш вопрос ответил администратор.',
      isRead: false,
    },
    {
      userId: "u-18",
      type: "review_rejected",
      title: "Отзыв отклонен",
      body: 'Ваш отзыв о поездке отклонен администраей.',
      isRead: false,
    },
  ];
  const allNotifications = [...notifications, ...newNotifications];
  for (const n of allNotifications) {
    await prisma.notification.create({ data: n });
  }

  // Обращения в поддержку: с ответом админа / без / апелляция.
  const feedbacks = [
    {
      userId: "u-4",
      subject: "Не могу найти поездку",
      text: "Ищу поездку Вологда → Череповец на завтра, но в выдаче пусто. Так и должно быть?",
    },
    {
      userId: "u-14",
      subject: "Вопрос про оплату",
      text: "Оплата водителю наличными или переводом? В приложении кнопки оплаты не нашёл.",
      reply: "Оплата происходит напрямую водителю при встрече — наличными или переводом по договорённости.",
      repliedAt: new Date(seedNow.getTime() - 2 * dayMs),
    },
    {
      userId: "u-18",
      subject: "Жалоба на водителя",
      text: "Водитель уехал без меня, хотя я был на месте за 10 минут. Прошу разобраться.",
    },
    {
      userId: "u-19",
      subject: "Апелляция: отклонённый отзыв",
      text: "Мой отзыв о поездке отклонили, но я не нарушала правила. Пересмотрите, пожалуйста.",
      reply: "Проверили: в тексте был номер телефона. Уберите контакты и отправьте отзыв заново.",
      repliedAt: new Date(seedNow.getTime() - 5 * dayMs),
    },
    {
      userId: "u-22",
      subject: "Предложение: тёмная тема",
      text: "Было бы здорово добавить тёмную тему для ночных поездок.",
    },
  ];
  for (const f of feedbacks) {
    await prisma.feedback.create({ data: f });
  }

  // Create RideRequests
  for (const rr of rideRequests) {
    await prisma.rideRequest.create({
      data: {
        id: rr.id,
        userId: rr.userId,
        fromCityId: cityId(rr.fromCity),
        toCityId: cityId(rr.toCity),
        earliestAt: new Date(seedNow.getTime() + rr.daysFromNowEarliest * dayMs),
        latestAt: new Date(seedNow.getTime() + rr.daysFromNowLatest * dayMs),
        seats: rr.seats ?? 1,
        status: rr.status ?? "active",
        expiresAt: new Date(seedNow.getTime() + (rr.expiresInDays ?? 7) * dayMs),
      },
    });
  }

  // Create Reports
  for (const r of reports) {
    let targetId: string;
    if (r.targetType === "trip") {
      if (!r.tripRef) throw new Error(`[seed] report ${r.id}: нет tripRef`);
      targetId = r.tripRef;
    } else if (r.targetType === "booking") {
      if (!r.bookingRef) throw new Error(`[seed] report ${r.id}: нет bookingRef`);
      const booking = await prisma.booking.findFirst({
        where: { tripId: r.bookingRef.tripId, passengerId: r.bookingRef.passengerId },
        select: { id: true },
      });
      if (!booking) throw new Error(`[seed] report ${r.id}: бронь не найдена`);
      targetId = booking.id;
    } else {
      if (!r.targetUserId) throw new Error(`[seed] report ${r.id}: нет targetUserId`);
      targetId = r.targetUserId;
    }
    const terminal = r.status === "resolved" || r.status === "rejected";
    await prisma.report.create({
      data: {
        id: r.id,
        reporterId: r.reporterId,
        targetType: r.targetType,
        targetId,
        category: r.category,
        description: r.description,
        status: r.status ?? "pending",
        resolutionNote: r.resolutionNote ?? null,
        adminActorId: r.adminActorId ?? null,
        adminActorType: r.adminActorId ? "admin" : null,
        resolvedAt: terminal ? seedNow : null,
      },
    });
  }

  const stats = {
    users: await prisma.user.count(),
    cars: await prisma.car.count(),
    trips: await prisma.trip.count(),
    bookings: await prisma.booking.count(),
    reviews: await prisma.review.count(),
    notifications: await prisma.notification.count(),
    feedbacks: await prisma.feedback.count(),
    cities: await prisma.city.count(),
    rideRequests: await prisma.rideRequest.count(),
    reports: await prisma.report.count(),
  };
  console.log("Seeding rich mock data complete!", stats);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
