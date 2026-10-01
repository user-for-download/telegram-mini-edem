import { describe, expect, it, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const findFirst = vi.fn();
const findUniqueUser = vi.fn();
const notifyUser = vi.fn();
const sendToUser = vi.fn();
const tripSnapshotOf = vi
  .fn()
  .mockReturnValue({ from: "F", to: "T", price: 100 });

vi.mock("../../src/db.js", () => ({
  db: {
    rideRequest: { findMany },
    notification: { findFirst },
    user: { findUnique: findUniqueUser },
  },
}));
vi.mock("../../src/services/notification.service.js", () => ({
  notifyUser,
  tripSnapshotOf,
}));
vi.mock("../../src/ws/manager.js", () => ({
  wsManager: { sendToUser },
}));

const { notifyMatchingRideRequests } = await import("../../src/rideRequests/matching.js");

describe("RideRequest matching notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([{ id: "request-1", userId: "passenger-1" }]);
    findFirst.mockResolvedValue(null);
    findUniqueUser.mockResolvedValue({ name: "Илья Северов" });
  });

  const trip = {
    id: "trip-1",
    driverId: "driver-1",
    fromCityId: "from-city",
    toCityId: "to-city",
    departureAt: new Date("2030-01-01T10:00:00.000Z"),
    durationMinutes: 120,
  };

  it("notifies matching requester with a trip deep link", async () => {
    notifyUser.mockResolvedValue("n1");
    await notifyMatchingRideRequests(trip);
    expect(notifyUser).toHaveBeenCalledWith({
      userId: "passenger-1",
      type: "ride_request_match",
      title: "Подходящая поездка",
      body: expect.stringContaining("trip-1"),
      fragment: "/trips/trip-1",
      actorName: "Илья Северов",
      action: "matched",
      tripSnapshot: { from: "F", to: "T", price: 100 },
    });
    // Item 7: hint уходит внутри notifyUser — напрямую matching WS не шлёт
    // (null-id → без hint — контракт notifyUser, см. notification-push.test.ts).
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("does not duplicate a notification for the same trip", async () => {
    findFirst.mockResolvedValue({ id: "notification-1" });
    await notifyMatchingRideRequests(trip);
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
