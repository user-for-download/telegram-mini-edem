import { describe, expect, it } from "vitest";

import { buildBookingsSearchParams } from "./api";

describe("buildBookingsSearchParams", () => {
  it("keeps pagination and sends every active filter", () => {
    const params = buildBookingsSearchParams({
      status: "confirmed",
      q: "  Иван  ",
      passengerId: "passenger-1",
      tripId: "trip-1",
      page: 2,
      pageSize: 50,
    });

    expect(Object.fromEntries(params)).toEqual({
      page: "2",
      pageSize: "50",
      status: "confirmed",
      q: "Иван",
      passengerId: "passenger-1",
      tripId: "trip-1",
    });
  });

  it("omits empty and whitespace-only filters", () => {
    const params = buildBookingsSearchParams({
      q: "   ",
      passengerId: "",
      tripId: "  ",
      page: 1,
      pageSize: 20,
    });

    expect(Object.fromEntries(params)).toEqual({
      page: "1",
      pageSize: "20",
    });
  });
});
