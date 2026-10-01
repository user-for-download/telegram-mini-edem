import { describe, expect, it } from "vitest";
import {
  CRITICAL_NOTIFICATION_TYPES,
  NOTIFICATION_ROLE_TYPES,
  notificationSchema,
  notificationsPageSchema,
  notificationsQuerySchema,
  unreadCountSchema,
} from "../src/index.js";

const notification = {
  id: "n-1",
  userId: "u-1",
  type: "booking_status",
  title: "Бронь подтверждена",
  body: "Водитель подтвердил вашу бронь",
  isRead: false,
  deepLink: "/trips/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
  actorName: "Илья Северов",
  action: "confirmed",
  tripFrom: "Вологда",
  tripTo: "Череповец",
  tripPrice: 500,
  tripDepartureAt: "2026-09-10T09:00:00.000Z",
  createdAt: "2026-09-09T10:00:00.000Z",
};

describe("notification contracts", () => {
  it("accepts the backend notification representation", () => {
    expect(notificationSchema.parse(notification)).toEqual(notification);
  });

  it("accepts a notification page with a nullable cursor", () => {
    expect(
      notificationsPageSchema.parse({
        items: [notification],
        nextCursor: null,
        unreadCount: 1,
      }),
    ).toMatchObject({ items: [notification], nextCursor: null });
  });

  it("accepts a nullable deepLink (type map fallback)", () => {
    expect(
      notificationSchema.safeParse({ ...notification, deepLink: null }).success,
    ).toBe(true);
  });

  it("accepts nullable actor/action (legacy rows hide lines)", () => {
    expect(
      notificationSchema.safeParse({
        ...notification,
        actorName: null,
        action: null,
      }).success,
    ).toBe(true);
  });

  it("accepts a nullable trip snapshot (non-trip events)", () => {
    expect(
      notificationSchema.safeParse({
        ...notification,
        tripFrom: null,
        tripTo: null,
        tripPrice: null,
        tripDepartureAt: null,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed notification dates and counts", () => {
    expect(
      notificationSchema.safeParse({ ...notification, createdAt: "not-a-date" })
        .success,
    ).toBe(false);
    expect(
      notificationsPageSchema.safeParse({
        items: [],
        nextCursor: null,
        unreadCount: -1,
      }).success,
    ).toBe(false);
  });
});

describe("notification role/critical sets (single source, m3/m6)", () => {
  it("critical set: только статусные типы", () => {
    expect([...CRITICAL_NOTIFICATION_TYPES].sort()).toEqual([
      "booking_status_changed",
      "trip_cancelled",
      "trip_status_changed",
    ]);
  });

  it("role map: match — пассажир, trip_status_changed — оба, нейтраль — нигде", () => {
    expect(NOTIFICATION_ROLE_TYPES.driver.has("booking_created")).toBe(true);
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("ride_request_match")).toBe(
      true,
    );
    expect(NOTIFICATION_ROLE_TYPES.driver.has("ride_request_match")).toBe(
      false,
    );
    expect(NOTIFICATION_ROLE_TYPES.driver.has("trip_status_changed")).toBe(
      true,
    );
    expect(NOTIFICATION_ROLE_TYPES.passenger.has("trip_status_changed")).toBe(
      true,
    );
    for (const neutral of ["review_approved", "review_rejected", "feedback_replied"]) {
      expect(NOTIFICATION_ROLE_TYPES.driver.has(neutral)).toBe(false);
      expect(NOTIFICATION_ROLE_TYPES.passenger.has(neutral)).toBe(false);
    }
  });

  it("query schema: role/unreadOnly опциональны, мусор отвергается", () => {
    expect(notificationsQuerySchema.safeParse({}).success).toBe(true);
    expect(
      notificationsQuerySchema.safeParse({ role: "driver", unreadOnly: "1" })
        .success,
    ).toBe(true);
    expect(notificationsQuerySchema.safeParse({ role: "admin" }).success).toBe(
      false,
    );
    expect(
      notificationsQuerySchema.safeParse({ unreadOnly: "yes" }).success,
    ).toBe(false);
  });
});

describe("unreadCountSchema (GET /notifications/unread-count)", () => {
  it("parses a valid unread count", () => {
    expect(unreadCountSchema.parse({ unreadCount: 2 })).toEqual({
      unreadCount: 2,
    });
    expect(unreadCountSchema.parse({ unreadCount: 0 })).toEqual({
      unreadCount: 0,
    });
  });

  it("rejects negative, non-int and extra keys (strict)", () => {
    expect(
      unreadCountSchema.safeParse({ unreadCount: -1 }).success,
    ).toBe(false);
    expect(unreadCountSchema.safeParse({ unreadCount: 1.5 }).success).toBe(
      false,
    );
    expect(
      unreadCountSchema.safeParse({ unreadCount: "2" }).success,
    ).toBe(false);
    expect(unreadCountSchema.safeParse({}).success).toBe(false);
    expect(
      unreadCountSchema.safeParse({ unreadCount: 1, extra: true }).success,
    ).toBe(false);
  });
});
