import { describe, expect, it } from "vitest";
import {
  FALLBACK_ROUTE,
  START_PARAM_ROUTES,
  parseTripStartParam,
  resolveStartParamRoute,
} from "@/router/deepLinks";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

// Маршруты ниже обязаны существовать в AppRouter (Routes):
// /trips, /trips/:tripId, /trips/my/new, /bookings, /profile,
// /profile/history, /reviews, /settings, /notifications, /profile/support.
const KNOWN_ROUTES = new Set([
  "/trips",
  "/trips/my/new",
  "/bookings",
  "/bookings?segment=driver",
  "/profile",
  "/profile/history",
  "/reviews",
  "/profile/support",
  "/notifications",
  "/settings",
]);

describe("parseTripStartParam", () => {
  it("принимает UUID и префикс trip_", () => {
    expect(parseTripStartParam(UUID)).toBe(UUID);
    expect(parseTripStartParam(`trip_${UUID}`)).toBe(UUID);
  });

  it("принимает UUID в верхнем регистре", () => {
    const upper = UUID.toUpperCase();
    expect(parseTripStartParam(`trip_${upper}`)).toBe(upper);
  });

  it("отклоняет мусор и не-UUID", () => {
    expect(parseTripStartParam(null)).toBeNull();
    expect(parseTripStartParam(undefined)).toBeNull();
    expect(parseTripStartParam(42)).toBeNull();
    expect(parseTripStartParam("")).toBeNull();
    expect(parseTripStartParam("trip_")).toBeNull();
    expect(parseTripStartParam("not-a-trip")).toBeNull();
    expect(parseTripStartParam("trip_zzz")).toBeNull();
    // Похоже на UUID, но невалидная версия/вариант — не пропускаем.
    expect(parseTripStartParam("trip_123e4567-e89b-02d3-a456-426614174000")).toBeNull();
    // Инъекция маршрута через токен — не пропускаем.
    expect(parseTripStartParam(`trip_${UUID}/requests`)).toBeNull();
    expect(parseTripStartParam(`trip_${UUID} `)).toBeNull();
  });
});

describe("START_PARAM_ROUTES (контракт)", () => {
  it("ведёт на существующие маршруты AppRouter", () => {
    expect(START_PARAM_ROUTES["bookings"]).toBe("/bookings");
    expect(START_PARAM_ROUTES["history"]).toBe("/profile/history");
    expect(START_PARAM_ROUTES["my_trips"]).toBe("/bookings?segment=driver");
    expect(START_PARAM_ROUTES["profile"]).toBe("/profile");
    expect(START_PARAM_ROUTES["reviews"]).toBe("/reviews");
    expect(START_PARAM_ROUTES["support"]).toBe("/profile/support");
    expect(START_PARAM_ROUTES["notifications"]).toBe("/notifications");
    expect(START_PARAM_ROUTES["settings"]).toBe("/settings");
    expect(START_PARAM_ROUTES["trips"]).toBe("/trips");
    expect(START_PARAM_ROUTES["search"]).toBe("/trips");
    expect(START_PARAM_ROUTES["create"]).toBe("/trips/my/new");
    expect(START_PARAM_ROUTES["new"]).toBe("/trips/my/new");
    for (const route of Object.values(START_PARAM_ROUTES)) {
      expect(KNOWN_ROUTES.has(route)).toBe(true);
    }
  });
});

describe("resolveStartParamRoute", () => {
  it("trip_токен ведёт на детали поездки", () => {
    expect(resolveStartParamRoute(`trip_${UUID}`)).toBe(`/trips/${UUID}`);
    expect(resolveStartParamRoute(UUID)).toBe(`/trips/${UUID}`);
  });

  it("section-токены ведут на свои разделы", () => {
    expect(resolveStartParamRoute("bookings")).toBe("/bookings");    expect(resolveStartParamRoute("history")).toBe("/profile/history");
    expect(resolveStartParamRoute("profile")).toBe("/profile");
    expect(resolveStartParamRoute("reviews")).toBe("/reviews");
    expect(resolveStartParamRoute("support")).toBe("/profile/support");
    expect(resolveStartParamRoute("my_trips")).toBe("/bookings?segment=driver");
    expect(resolveStartParamRoute("notifications")).toBe("/notifications");
    expect(resolveStartParamRoute("settings")).toBe("/settings");
    expect(resolveStartParamRoute("search")).toBe("/trips");
    expect(resolveStartParamRoute("create")).toBe("/trips/my/new");
    expect(resolveStartParamRoute("new")).toBe("/trips/my/new");
  });

  it("пустое/отсутствующее значение — null (навигации нет)", () => {
    expect(resolveStartParamRoute(null)).toBeNull();
    expect(resolveStartParamRoute(undefined)).toBeNull();
    expect(resolveStartParamRoute("")).toBeNull();
  });

  it("неизвестный/битый параметр — безопасный fallback без исключений", () => {
    expect(resolveStartParamRoute("nope")).toBe(FALLBACK_ROUTE);
    expect(resolveStartParamRoute("trip_zzz")).toBe(FALLBACK_ROUTE);
    expect(resolveStartParamRoute("__proto__")).toBe(FALLBACK_ROUTE);
    expect(resolveStartParamRoute("Bookings")).toBe(FALLBACK_ROUTE);
    expect(resolveStartParamRoute(42)).toBeNull();
    expect(FALLBACK_ROUTE).toBe("/trips");
  });
});
