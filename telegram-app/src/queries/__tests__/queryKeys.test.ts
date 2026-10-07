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
    expect(RIDE_REQUEST_KEYS.trip("trip-1")).toEqual([
      "ride-requests",
      "trip",
      "trip-1",
    ]);
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
