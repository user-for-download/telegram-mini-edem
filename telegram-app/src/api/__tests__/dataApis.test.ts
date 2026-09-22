import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  apiClient: { request: vi.fn() },
}));

import { apiClient } from "@/api/client";
import { bookingsApi } from "@/api/bookings.api";
import { citiesApi } from "@/api/cities.api";
import { rideRequestsApi } from "@/api/rideRequests.api";
import { tripsApi } from "@/api/trips.api";

const requestMock = vi.mocked(apiClient.request);

describe("Telegram data API adapters", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("serializes trip filters and forwards the cancellation signal", () => {
    const signal = new AbortController().signal;

    void tripsApi.getTrips(
      {
        q: "центр",
        fromCity: "Москва",
        tags: ["Есть багаж", "Не курить"],
        maxPrice: 1500,
        page: 2,
        limit: 20,
      },
      signal,
    );

    expect(requestMock).toHaveBeenCalledTimes(1);
    const firstCall = requestMock.mock.calls[0];
    if (!firstCall) throw new Error("request was not called");
    const [endpoint, options, schema] = firstCall;
    const url = new URL(endpoint, "https://example.test");
    expect(url.pathname).toBe("/trips");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "центр",
      fromCity: "Москва",
      tags: "Есть багаж,Не курить",
      maxPrice: "1500",
      page: "2",
      limit: "20",
    });
    expect(options).toEqual({ signal });
    expect(schema).toBeDefined();
  });

  it("encodes path parameters and cursor pagination", () => {
    const signal = new AbortController().signal;

    void bookingsApi.getTripBookings("trip/with space", "next/token", 25, signal);

    expect(requestMock).toHaveBeenCalledWith(
      "/bookings/trip/trip%2Fwith%20space?limit=25&cursor=next%2Ftoken",
      { signal },
      expect.anything(),
    );
  });

  it("requests the full city directory without an empty q parameter", () => {
    void citiesApi.suggest("");

    expect(requestMock).toHaveBeenCalledWith(
      "/cities/suggest?limit=100",
      { signal: undefined },
      expect.anything(),
    );
  });

  it("uses the dedicated ride-request status endpoint and JSON body", () => {
    void rideRequestsApi.setStatus("request/id", "paused");

    expect(requestMock).toHaveBeenCalledWith(
      "/ride-requests/request%2Fid/status",
      { method: "PATCH", body: JSON.stringify({ status: "paused" }) },
      expect.anything(),
    );
  });
});
