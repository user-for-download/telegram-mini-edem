import { describe, it, expect } from "vitest";
import { createBookingDtoSchema } from "../src/dto/booking.dto";
import { MAX_SEATS } from "../src/schemas/trip.schema";
import {
  bookingSchema,
  bookingStatusSchema,
  driverBookingActionSchema,
} from "../src/schemas/booking.schema";

describe("createBookingDtoSchema", () => {
  it("should parse valid booking dto", () => {
    const result = createBookingDtoSchema.safeParse({
      tripId: "t-1",
      seat: 2,
      comment: "Возьму небольшой рюкзак",
    });
    expect(result.success).toBe(true);
  });

  it(`should reject booking with seat > MAX_SEATS (${MAX_SEATS})`, () => {
    const result = createBookingDtoSchema.safeParse({
      tripId: "t-1",
      seat: MAX_SEATS + 1,
    });
    expect(result.success).toBe(false);
  });

  it(`should accept booking with seat = MAX_SEATS (${MAX_SEATS})`, () => {
    const result = createBookingDtoSchema.safeParse({
      tripId: "t-1",
      seat: MAX_SEATS,
    });
    expect(result.success).toBe(true);
  });

  it("should reject booking with long comment", () => {
    const result = createBookingDtoSchema.safeParse({
      tripId: "t-1",
      seat: 2,
      comment: "a".repeat(301),
    });
    expect(result.success).toBe(false);
  });
});

describe("bookingSchema (response)", () => {
  const driver = {
    id: "u-2",
    name: "Марина Ковалёва",
    avatar: "https://i.pravatar.cc/200?img=32",
    rating: 4.8,
    reviewsCount: 21,
    tripsCount: 40,
  };

  const passenger = {
    id: "u-3",
    name: "Игорь Соколов",
    avatar: "https://i.pravatar.cc/200?img=12",
    rating: 4.5,
    reviewsCount: 7,
    tripsCount: 12,
  };

  const trip = {
    id: "t-1",
    fromCity: "Москва",
    toCity: "Санкт-Петербург",
    date: "3 августа, пн",
    time: "09:30",
    durationMinutes: 470,
    distanceKm: 705,
    price: 1450,
    seatsTotal: MAX_SEATS,
    seatsAvailable: 0,
    driver,
    tags: ["Тихая поездка"],
    autoComplete: true,
    matchingEnabled: true,
  };

  it(`should accept booking with seat = MAX_SEATS (${MAX_SEATS})`, () => {
    const result = bookingSchema.safeParse({
      id: "b-1",
      trip,
      passenger,
      seat: MAX_SEATS,
      status: "confirmed",
    });
    expect(result.success).toBe(true);
  });

  it("should reject booking with seat > MAX_SEATS", () => {
    const result = bookingSchema.safeParse({
      id: "b-1",
      trip,
      passenger,
      seat: MAX_SEATS + 1,
      status: "confirmed",
    });
    expect(result.success).toBe(false);
  });
});

describe("bookingStatusSchema", () => {
  it("should accept cancelled", () => {
    expect(bookingStatusSchema.safeParse("cancelled").success).toBe(true);
  });

  it("should accept all four statuses", () => {
    for (const s of ["pending", "confirmed", "declined", "cancelled"]) {
      expect(bookingStatusSchema.safeParse(s).success).toBe(true);
    }
  });
});

describe("driverBookingActionSchema", () => {
  it("should accept confirmed", () => {
    expect(driverBookingActionSchema.safeParse("confirmed").success).toBe(true);
  });

  it("should accept declined", () => {
    expect(driverBookingActionSchema.safeParse("declined").success).toBe(true);
  });

  it("should reject cancelled", () => {
    expect(driverBookingActionSchema.safeParse("cancelled").success).toBe(false);
  });

  it("should reject pending", () => {
    expect(driverBookingActionSchema.safeParse("pending").success).toBe(false);
  });
});
