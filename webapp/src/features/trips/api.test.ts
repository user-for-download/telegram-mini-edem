import { describe, expect, it } from "vitest";

import { buildTripsSearchParams } from "./api";

describe("buildTripsSearchParams", () => {
  it("keeps pagination and sends every active filter", () => {
    const params = buildTripsSearchParams({
      status: "active",
      q: "  Москва  ",
      driverId: "driver-1",
      fromCity: "Москва",
      toCity: "Тверь",
      page: 2,
      pageSize: 10,
    });

    expect(Object.fromEntries(params)).toEqual({
      page: "2",
      pageSize: "10",
      status: "active",
      q: "Москва",
      driverId: "driver-1",
      fromCity: "Москва",
      toCity: "Тверь",
    });
  });

  it("omits empty and whitespace-only filters", () => {
    const params = buildTripsSearchParams({
      q: "   ",
      driverId: "",
      fromCity: " ",
      toCity: "",
      page: 1,
      pageSize: 20,
    });

    expect(Object.fromEntries(params)).toEqual({
      page: "1",
      pageSize: "20",
    });
  });
});
