import { describe, expect, it } from "vitest";
import {
  CRITICAL_NOTIFICATION_TYPES,
  DRIVER_INVITE_NOTIFICATION_TYPE,
  NOTIFICATION_ROLE_TYPES,
  driverInviteNotificationSchema,
  notificationSchema,
  tripIdFromDeepLink,
} from "../notification.schema.js";
import { wsServerEventSchema } from "../ws.schema.js";

const TRIP_ID = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";

/**
 * Валидная строка приглашения: обычная notification-строка, у которой
 * контекст поездки заполнен (deep-link ведёт в карточку поездки).
 */
const invite = {
  id: "n-1",
  userId: "u-1",
  type: DRIVER_INVITE_NOTIFICATION_TYPE,
  title: "Водитель позвал вас в поездку",
  body: "Вологда → Череповец, 10 сентября, 09:00. Места есть.",
  isRead: false,
  deepLink: `/trips/${TRIP_ID}`,
  actorName: "Илья Северов",
  action: null,
  tripFrom: "Вологда",
  tripTo: "Череповец",
  tripPrice: 500,
  tripDepartureAt: "2026-09-10T09:00:00.000Z",
  createdAt: "2026-09-09T10:00:00.000Z",
};

describe("ws.schema: ride_request:new (хинт спроса водителю)", () => {
  it("принимает хинт с tripId", () => {
    const parsed = wsServerEventSchema.safeParse({
      type: "ride_request:new",
      payload: { tripId: "t-77" },
    });
    expect(parsed.success).toBe(true);
  });

  it("отвергает хинт без tripId: спрос живёт по поездке", () => {
    // Без адреса клиент не знает, какую карточку спроса обновлять, а
    // молча инвалидировать всё — значит дёрнуть лишние поездки водителя.
    const parsed = wsServerEventSchema.safeParse({
      type: "ride_request:new",
      payload: {},
    });
    expect(parsed.success).toBe(false);
  });
});

describe("driver_invite: валидное приглашение", () => {
  it("проходит схему приглашения", () => {
    expect(driverInviteNotificationSchema.parse(invite)).toEqual(invite);
  });

  it("остаётся валидной обычной notification-строкой (её же шлёт бэкенд)", () => {
    expect(notificationSchema.safeParse(invite).success).toBe(true);
  });

  it("id поездки достаётся из deep-link", () => {
    expect(tripIdFromDeepLink(`/trips/${TRIP_ID}`)).toBe(TRIP_ID);
  });
});

describe("driver_invite: битый deep-link отклоняется", () => {
  it("не строка и не маршрут — reject", () => {
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, deepLink: 42 }).success,
    ).toBe(false);
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, deepLink: null }).success,
    ).toBe(false);
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, deepLink: "/notifications" })
        .success,
    ).toBe(false);
  });

  it("id не UUID — reject (allowlist допускает только UUID)", () => {
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, deepLink: "/trips/t-1" })
        .success,
    ).toBe(false);
  });

  it("query/hash в маршруте — reject (allowlist их запрещает)", () => {
    expect(
      driverInviteNotificationSchema.safeParse({
        ...invite,
        deepLink: `/trips/${TRIP_ID}?invite=1`,
      }).success,
    ).toBe(false);
    expect(
      driverInviteNotificationSchema.safeParse({
        ...invite,
        deepLink: `/trips/${TRIP_ID}#top`,
      }).success,
    ).toBe(false);
  });

  it("битый маршрут не вытаскивается как id поездки", () => {
    expect(tripIdFromDeepLink("/trips/t-1")).toBeNull();
    expect(tripIdFromDeepLink(`/trips/${TRIP_ID}?invite=1`)).toBeNull();
    expect(tripIdFromDeepLink("/notifications")).toBeNull();
  });
});

describe("driver_invite: обязательный контекст поездки", () => {
  it("пустые города — reject", () => {
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, tripFrom: "" }).success,
    ).toBe(false);
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, tripTo: "" }).success,
    ).toBe(false);
  });

  it("null вместо городов/времени — reject", () => {
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, tripFrom: null }).success,
    ).toBe(false);
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, tripTo: null }).success,
    ).toBe(false);
    expect(
      driverInviteNotificationSchema.safeParse({ ...invite, tripDepartureAt: null })
        .success,
    ).toBe(false);
  });

  it("пропущенные поля контекста — reject", () => {
    const { tripFrom: _from, tripTo: _to, tripDepartureAt: _at, ...withoutContext } =
      invite;
    expect(driverInviteNotificationSchema.safeParse(withoutContext).success).toBe(
      false,
    );
  });

  it("время не ISO-дата — reject", () => {
    expect(
      driverInviteNotificationSchema.safeParse({
        ...invite,
        tripDepartureAt: "10.09.2026 09:00",
      }).success,
    ).toBe(false);
  });

  it("чужой тип с заполненным контекстом — reject (literal)", () => {
    expect(
      driverInviteNotificationSchema.safeParse({
        ...invite,
        type: "ride_request_match",
      }).success,
    ).toBe(false);
  });
});

describe("driver_invite: роль и критичность (контракт доставки)", () => {
  it("не критичный — персистится по тумблеру и уходит в Telegram по нему же", () => {
    expect(CRITICAL_NOTIFICATION_TYPES.has(DRIVER_INVITE_NOTIFICATION_TYPE)).toBe(
      false,
    );
  });

  it("роль получателя — пассажир (автор заявки)", () => {
    expect(
      NOTIFICATION_ROLE_TYPES.passenger.has(DRIVER_INVITE_NOTIFICATION_TYPE),
    ).toBe(true);
    expect(
      NOTIFICATION_ROLE_TYPES.driver.has(DRIVER_INVITE_NOTIFICATION_TYPE),
    ).toBe(false);
  });
});
