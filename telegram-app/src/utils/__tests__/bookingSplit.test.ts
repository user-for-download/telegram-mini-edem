// Юнит-тесты чистых хелперов разделения броней (без jsdom — DOM-free модуль).
import { describe, expect, it } from "vitest";
import type { PassengerBooking } from "@edem/contracts";
import {
  confirmedSectionHeader,
  formatSeatNumber,
  isUpcomingBooking,
  splitBookingsByStatus,
} from "@/utils/bookingSplit";

function makeBooking(overrides: Record<string, unknown> = {}): PassengerBooking {
  return {
    id: "b-1",
    seat: 1,
    status: "confirmed",
    trip: {
      id: "t-1",
      fromCity: "Вологда",
      toCity: "Череповец",
      date: "2030-06-01",
      time: "09:00",
      departureAt: "2030-06-01T09:00:00.000Z",
      price: 450,
      driver: { name: "Александр", avatar: "https://t.me/a.png", rating: 5, reviewsCount: 0, tripsCount: 0 },
    },
    ...overrides,
  } as unknown as PassengerBooking;
}

const now = new Date("2030-06-01T00:00:00.000Z");

describe("isUpcomingBooking", () => {
  it("будущее отправление — активная", () => {
    expect(isUpcomingBooking(makeBooking(), now)).toBe(true);
  });

  it("прошедшее отправление — не активная (история)", () => {
    const past = makeBooking({
      trip: { departureAt: "2029-01-01T09:00:00.000Z" },
    });
    expect(isUpcomingBooking(past, now)).toBe(false);
  });

  it("отсутствие даты отправления — не активная", () => {
    expect(
      isUpcomingBooking(
        makeBooking({ trip: { departureAt: undefined } }),
        now,
      ),
    ).toBe(false);
  });
});

describe("splitBookingsByStatus", () => {
  it("разделяет по статусам и сортирует по времени отправления", () => {
    const { confirmed, pending } = splitBookingsByStatus(
      [
        makeBooking({ id: "b-late" }),
        makeBooking({
          id: "b-early",
          status: "confirmed",
          trip: { departureAt: "2030-06-02T09:00:00.000Z" },
        }),
        makeBooking({
          id: "b-later",
          trip: { departureAt: "2030-06-10T09:00:00.000Z" },
        }),
        makeBooking({ id: "b-pending", status: "pending" }),
      ],
      now,
    );

    expect(confirmed.map((b) => b.id)).toEqual([
      "b-late",
      "b-early",
      "b-later",
    ]);
    expect(pending.map((b) => b.id)).toEqual(["b-pending"]);
  });

  it("отбрасывает declined/cancelled и прошедшие брони", () => {
    const { confirmed, pending } = splitBookingsByStatus(
      [
        makeBooking({ id: "b-declined", status: "declined" }),
        makeBooking({ id: "b-cancelled", status: "cancelled" }),
        makeBooking({
          id: "b-past",
          trip: { departureAt: "2029-06-01T09:00:00.000Z" },
        }),
      ],
      now,
    );
    expect(confirmed).toEqual([]);
    expect(pending).toEqual([]);
  });
});

describe("confirmedSectionHeader", () => {
  it("одна бронь — единственное число", () => {
    expect(confirmedSectionHeader(1)).toBe("Ваша поездка");
  });

  it("несколько броней — множественное", () => {
    expect(confirmedSectionHeader(2)).toBe("Ваши поездки");
    expect(confirmedSectionHeader(5)).toBe("Ваши поездки");
  });
});

describe("formatSeatNumber", () => {
  it("seat — порядковый номер места, не количество", () => {
    expect(formatSeatNumber(1)).toBe("место №1");
    expect(formatSeatNumber(2)).toBe("место №2");
    expect(formatSeatNumber(3)).toBe("место №3");
  });
});