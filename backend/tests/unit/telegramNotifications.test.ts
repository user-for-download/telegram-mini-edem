// backend/tests/unit/telegramNotifications.test.ts
//
// Политика TG-доставки (live dispatcher, Bot API approved 2026-09-14):
// чистые функции с мокнутыми db/env (паттерн notification-push.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();

vi.mock("../../src/db.js", () => ({
  db: { notification: { findFirst } },
}));

const debugMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();
vi.mock("../../src/logger.js", () => ({
  logger: { debug: debugMock, info: infoMock, error: errorMock },
}));

const envState = {
  TELEGRAM_DELIVERY_ENABLED: true,
  TG_NOTIFICATION_DEDUPE_WINDOW_MS: 60_000,
};
vi.mock("../../src/env.js", () => ({
  env: envState,
}));

const {
  shouldDeliverTelegram,
  decideTelegramDelivery,
  resolveTelegramDeepLink,
  findNotificationDuplicate,
  TELEGRAM_FALLBACK_ROUTE,
} = await import("../../src/services/telegramNotifications.js");

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("decideTelegramDelivery — полная политика с согласием (live dispatcher)", () => {
  it("kill-switch → channel_disabled, даже для critical с чатом", () => {
    expect(
      decideTelegramDelivery({
        type: "trip_cancelled",
        notificationsEnabled: true,
        chatJoined: true,
        channelEnabled: false,
      }),
    ).toEqual({ deliver: false, reason: "channel_disabled" });
  });

  it("нет чата с ботом → no_chat, тихо, даже critical с тумблером", () => {
    expect(
      decideTelegramDelivery({
        type: "trip_cancelled",
        notificationsEnabled: true,
        chatJoined: false,
        channelEnabled: true,
      }),
    ).toEqual({ deliver: false, reason: "no_chat" });
  });

  it("critical + чат + выключенный тумблер → доставляем", () => {
    expect(
      decideTelegramDelivery({
        type: "booking_status_changed",
        notificationsEnabled: false,
        chatJoined: true,
        channelEnabled: true,
      }),
    ).toEqual({ deliver: true });
  });

  it("trip_details_changed — critical: чат + выключенный тумблер → доставляем", () => {
    expect(
      decideTelegramDelivery({
        type: "trip_details_changed",
        notificationsEnabled: false,
        chatJoined: true,
        channelEnabled: true,
      }),
    ).toEqual({ deliver: true });
  });

  it("optional + чат + выключенный тумблер → notifications_disabled", () => {
    expect(
      decideTelegramDelivery({
        type: "review_approved",
        notificationsEnabled: false,
        chatJoined: true,
        channelEnabled: true,
      }),
    ).toEqual({ deliver: false, reason: "notifications_disabled" });
  });

  it("optional + чат + включённый тумблер → доставляем", () => {
    expect(
      decideTelegramDelivery({
        type: "feedback_replied",
        notificationsEnabled: true,
        chatJoined: true,
        channelEnabled: true,
      }),
    ).toEqual({ deliver: true });
  });

  it("channelEnabled по умолчанию включён (undefined = канал жив)", () => {
    expect(
      decideTelegramDelivery({
        type: "trip_cancelled",
        notificationsEnabled: true,
        chatJoined: true,
      }),
    ).toEqual({ deliver: true });
  });

  it("порядок приоритета: kill-switch важнее отсутствия чата", () => {
    expect(
      decideTelegramDelivery({
        type: "trip_cancelled",
        notificationsEnabled: false,
        chatJoined: false,
        channelEnabled: false,
      }),
    ).toEqual({ deliver: false, reason: "channel_disabled" });
  });
});

describe("shouldDeliverTelegram — opt-out / critical override", () => {
  it("critical игнорирует выключенный тумблер", () => {
    expect(shouldDeliverTelegram("booking_status_changed", false)).toBe(true);
    expect(shouldDeliverTelegram("trip_cancelled", false)).toBe(true);
    expect(shouldDeliverTelegram("trip_status_changed", false)).toBe(true);
    expect(shouldDeliverTelegram("trip_details_changed", false)).toBe(true);
  });

  it("optional подчиняется тумблеру", () => {
    expect(shouldDeliverTelegram("booking_created", true)).toBe(true);
    expect(shouldDeliverTelegram("booking_created", false)).toBe(false);
    expect(shouldDeliverTelegram("review_approved", false)).toBe(false);
  });
});

describe("resolveTelegramDeepLink — allowlist маршрутов", () => {
  it("точные реализованные маршруты пропускаются", () => {
    expect(resolveTelegramDeepLink("/bookings")).toBe("/bookings");
    expect(resolveTelegramDeepLink("/bookings/history")).toBe(
      "/bookings/history",
    );
    expect(resolveTelegramDeepLink("/trips/my")).toBe("/trips/my");
    expect(resolveTelegramDeepLink("/notifications")).toBe("/notifications");
    expect(resolveTelegramDeepLink("/profile/support")).toBe(
      "/profile/support",
    );
    expect(resolveTelegramDeepLink("/reviews")).toBe("/reviews");
    // Заявки на попутку уехали в поддерево профиля (/ride-requests
    // больше нет): без этой строки тап по уведомлению о матче заявки
    // уходил бы в /notifications.
    expect(resolveTelegramDeepLink("/profile/ride-requests")).toBe(
      "/profile/ride-requests",
    );
    expect(resolveTelegramDeepLink("/ride-requests")).toBe(
      TELEGRAM_FALLBACK_ROUTE,
    );
  });

  it("параметризованные маршруты — только с UUID", () => {
    expect(resolveTelegramDeepLink(`/trips/${UUID}`)).toBe(`/trips/${UUID}`);
    expect(resolveTelegramDeepLink(`/trips/my/${UUID}/requests`)).toBe(
      `/trips/my/${UUID}/requests`,
    );
    expect(resolveTelegramDeepLink("/trips/not-a-uuid")).toBe(
      TELEGRAM_FALLBACK_ROUTE,
    );
  });

  it("пустой/неизвестный/подозрительный → безопасный фолбэк", () => {
    expect(resolveTelegramDeepLink(undefined)).toBe(TELEGRAM_FALLBACK_ROUTE);
    expect(resolveTelegramDeepLink("")).toBe(TELEGRAM_FALLBACK_ROUTE);
    expect(resolveTelegramDeepLink("/admin/users")).toBe(
      TELEGRAM_FALLBACK_ROUTE,
    );
    expect(resolveTelegramDeepLink("/bookings?token=secret")).toBe(
      TELEGRAM_FALLBACK_ROUTE,
    );
    expect(resolveTelegramDeepLink("/bookings#frag")).toBe(
      TELEGRAM_FALLBACK_ROUTE,
    );
    expect(resolveTelegramDeepLink("/trips/my trips")).toBe(
      TELEGRAM_FALLBACK_ROUTE,
    );
  });
});

describe("findNotificationDuplicate — окно дедупликации", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("находит идентичную свежую запись", async () => {
    findFirst.mockResolvedValue({ id: "n1" });
    const dup = await findNotificationDuplicate({
      userId: "u1",
      type: "trip_cancelled",
      title: "T",
      body: "B",
    });
    expect(dup).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("без совпадения — не дубликат", async () => {
    findFirst.mockResolvedValue(null);
    const dup = await findNotificationDuplicate({
      userId: "u1",
      type: "trip_cancelled",
      title: "T",
      body: "B",
    });
    expect(dup).toBe(false);
  });
});
