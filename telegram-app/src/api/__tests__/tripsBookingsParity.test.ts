import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  apiClient: { request: vi.fn() },
}));

import { apiClient } from "@/api/client";
import { bookingsApi } from "@/api/bookings.api";
import { tripsApi } from "@/api/trips.api";

const requestMock = vi.mocked(apiClient.request);

/**
 * Паритетные API-обёртки trips/bookings (tg-migration-12): edit trip,
 * destructive actions, my-trips archive filter, booking seat+comment
 * без хардкода.
 */
describe("Telegram trips/bookings API parity", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("sends trip updates without route fields (backend strict schema)", () => {
    const data = {
      fromAddress: "м. Тёплый Стан",
      price: 700,
      seatsTotal: 2,
    };
    void tripsApi.updateTrip("trip-1", data);

    expect(requestMock).toHaveBeenCalledWith(
      "/trips/trip-1",
      { method: "PATCH", body: JSON.stringify(data) },
      expect.anything(),
    );
    expect("fromCity" in data).toBe(false);
    expect("toCity" in data).toBe(false);
  });

  it("uses dedicated cancel/complete endpoints", () => {
    void tripsApi.cancelTrip("trip-1");
    void tripsApi.completeTrip("trip-2");

    expect(requestMock).toHaveBeenCalledWith(
      "/trips/trip-1/cancel",
      { method: "PATCH" },
      expect.anything(),
    );
    expect(requestMock).toHaveBeenCalledWith(
      "/trips/trip-2/complete",
      { method: "PATCH" },
      expect.anything(),
    );
  });

  it("requests the driver archive via the backend status filter", () => {
    void tripsApi.getMyTrips({ status: "archive", limit: 20 });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const archiveCall = requestMock.mock.calls[0];
    if (!archiveCall) throw new Error("request was not called");
    const [endpoint] = archiveCall;
    const url = new URL(String(endpoint), "https://example.test");
    expect(url.pathname).toBe("/trips/my");
    expect(url.searchParams.get("status")).toBe("archive");
  });

  it("sends a trimmed literal own-trip query with pagination and cancellation", () => {
    const signal = new AbortController().signal;
    void tripsApi.getMyTrips({ status: "active", q: "  %_  ", page: 2, limit: 20 }, signal);
    const call = requestMock.mock.calls[0];
    if (!call) throw new Error("request was not called");
    const [endpoint, options] = call;
    const url = new URL(String(endpoint), "https://example.test");
    expect(url.pathname).toBe("/trips/my");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "active", q: "%_", page: "2", limit: "20",
    });
    expect(options).toEqual({ signal });
  });

  it("omits a whitespace-only q, but never truncates an invalid long query", () => {
    void tripsApi.getMyTrips({ q: "  " });
    expect(requestMock.mock.calls[0]?.[0]).toBe("/trips/my");
    void tripsApi.getMyTrips({ q: "x".repeat(101) });
    const url = new URL(String(requestMock.mock.calls[1]?.[0]), "https://example.test");
    expect(url.searchParams.get("q")).toHaveLength(101);
  });

  it("forwards the chosen seat and comment when creating a booking", () => {
    void bookingsApi.createBooking({
      tripId: "trip-1",
      seat: 2,
      comment: "буду с чемоданом",
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/bookings",
      {
        method: "POST",
        body: JSON.stringify({
          tripId: "trip-1",
          seat: 2,
          comment: "буду с чемоданом",
        }),
      },
      expect.anything(),
    );
  });

  it("serializes the full search filter set", () => {
    void tripsApi.getTrips({
      q: "центр",
      fromCity: "Москва",
      toCity: "Тула",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-05",
      maxPrice: 1500,
      tags: ["Не курить"],
    });

    const filterCall = requestMock.mock.calls[0];
    if (!filterCall) throw new Error("request was not called");
    const [endpoint] = filterCall;
    const url = new URL(String(endpoint), "https://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "центр",
      fromCity: "Москва",
      toCity: "Тула",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-05",
      maxPrice: "1500",
      tags: "Не курить",
    });
  });
});
