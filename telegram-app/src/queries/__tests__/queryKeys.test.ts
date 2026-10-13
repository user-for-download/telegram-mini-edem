import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOOKING_KEYS,
  CITY_KEYS,
  NOTIFICATION_KEYS,
  REPORT_KEYS,
  REVIEW_KEYS,
  RIDE_REQUEST_KEYS,
  SUPPORT_KEYS,
  TRIP_KEYS,
  USER_KEYS,
} from "@/queries";

/**
 * Инвалидация кэша — только по фабрике ключей, никогда литералом.
 *
 * Раньше три места писали `queryKey: ["bookings"]` / `["trips"]`: цикл
 * модулей не давал импортировать чужую фабрику. Ключи вынесены в ./keys,
 * цикл разорван по построению (там нет ни одного импорта хуков).
 *
 * Почему пин на текст исходника, а не на поведение: литерал и константа
 * дают ОДИНАКОВОЕ значение — `["bookings"] === BOOKING_KEYS.all`, поэтому
 * рантайм-тест был бы зелёным и на литерале, и на константе. Смена
 * префикса в фабрике тихо оставила бы литералы инвалидировать пустоту: ни
 * ошибка компиляции, ни падение теста. Единственный способ поймать это —
 * запретить литерал в исходнике.
 */
describe("инвалидация кэша не использует сырые ключи", () => {
  const queriesDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const modules = readdirSync(queriesDir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.includes("__tests__"));

  it.each(modules)("%s: queryKey без строкового литерала", (name) => {
    const source = readFileSync(join(queriesDir, name), "utf8");
    // Ловим `queryKey: ["…"]` — массив-литерал. Фабрики дают вызов
    // (BOOKING_KEYS.all, TRIP_KEYS.detail(id)) и под шаблон не подпадают.
    expect(source).not.toMatch(/queryKey:\s*\[\s*["']/);
  });
});

describe("Telegram query key factories", () => {
  it("keeps resource prefixes stable for broad mutation invalidation", () => {
    expect(TRIP_KEYS.detail("trip-1")).toEqual(["trips", "detail", "trip-1"]);
    expect(BOOKING_KEYS.trip("trip-1")).toEqual([
      "bookings",
      "trip",
      "trip-1",
    ]);
    expect(CITY_KEYS.directory()).toEqual(["cities", "all"]);
    expect(RIDE_REQUEST_KEYS.all).toEqual(["ride-requests"]);
    // Спрос на поездку лежит под тем же префиксом: инвалидация по `all`
    // после мутации заявки обновляет и карточку спроса у водителя.
    expect(USER_KEYS.detail("user-1")).toEqual([
      "users",
      "detail",
      "user-1",
    ]);
    expect(REVIEW_KEYS.userPaginated("user-1", 20)).toEqual([
      "reviews",
      "user",
      "user-1",
      "paginated",
      20,
    ]);
  });

  it("includes filters in trip-list cache identity", () => {
    const filters = { fromCity: "Москва", page: 2 };
    expect(TRIP_KEYS.list(filters)).toEqual([
      "trips",
      "list",
      filters,
    ]);
  });

  it("covers support/reports/notifications inbox identity (tg-migration-09)", () => {
    expect(SUPPORT_KEYS.mine()).toEqual(["feedback", "mine"]);
    expect(REPORT_KEYS.mine()).toEqual(["reports", "mine"]);
    expect(NOTIFICATION_KEYS.inbox(20)).toEqual([
      "notifications",
      "inbox",
      20,
      "unread",
    ]);
    expect(NOTIFICATION_KEYS.inbox(20, "driver")).toEqual([
      "notifications",
      "inbox",
      20,
      "driver",
    ]);
  });
});
