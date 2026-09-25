// F4: driving-вариант TripCard — «Отменить поездку» только для отменяемых
// статусов; шаринг всегда через внутренний shareTrip (кнопка «Поделиться
// поездкой»), мёртвого onShare в типе больше нет.
// Паттерн — SSR renderToString, как в tripStandardCard.test.tsx.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { TripCard } from "@/components/Trip/TripCard";
import type { PassengerBooking, Trip } from "@edem/contracts";

function render(element: ReactNode): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/bookings"]}>{element}</MemoryRouter>
    </AppRoot>,
  );
}

const DRIVER = {
  id: "u-me",
  name: "Я",
  avatar: "https://t.me/a.png",
  rating: 5,
  reviewsCount: 1,
  tripsCount: 2,
};

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "t-1",
    fromCity: "Вологда",
    toCity: "Череповец",
    date: "2030-06-01",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 120,
    distanceKm: 180,
    price: 450,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: DRIVER,
    tags: [],
    status: "active",
    pendingRequestsCount: 0,
    confirmedBookingsCount: 1,
    ...overrides,
  };
}

function renderDriving(trip: Trip): string {
  return render(
    <TripCard
      variant={{
        kind: "driving",
        trip,
        driverRating: 5,
        onCancel: () => {},
        cancelPending: false,
      }}
    />,
  );
}

function renderBooking(booking: PassengerBooking): string {
  return render(
    <TripCard
      variant={{
        kind: "booking",
        booking,
        onCancel: () => {},
        cancelPending: false,
      }}
    />,
  );
}

function makeBooking(status: PassengerBooking["status"]): PassengerBooking {
  return {
    id: "b-1",
    trip: makeTrip({ id: "t-9" }),
    passenger: { ...DRIVER, id: "u-pax", name: "Пассажир" },
    seat: 1,
    status,
  };
}

describe("TripCard driving cancel guard", () => {
  it("active: отмена и шаринг на месте", () => {
    const html = renderDriving(makeTrip({ status: "active" }));
    expect(html).toContain("Отменить поездку");
    expect(html).toContain("Поделиться поездкой");
  });

  it("cancelled/completed: кнопки отмены нет, шаринг остался", () => {
    for (const status of ["cancelled", "completed"] as const) {
      const html = renderDriving(makeTrip({ status }));
      expect(html).not.toContain("Отменить поездку");
      expect(html).toContain("Поделиться поездкой");
    }
  });

  it("без статуса (легаси): отмена доступна", () => {
    const trip = makeTrip();
    delete trip.status;
    const html = renderDriving(trip);
    expect(html).toContain("Отменить поездку");
  });

  it("onCancel зовётся через подтверждение", () => {
    const onCancel = vi.fn();
    const html = render(
      <TripCard
        variant={{
          kind: "driving",
          trip: makeTrip({ status: "active" }),
          driverRating: null,
          onCancel,
          cancelPending: false,
        }}
      />,
    );
    // SSR: триггер попапа с label отрендерен, onCancel — только по клику.
    expect(html).toContain("Отменить поездку");
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("TripCard booking guard (регрессия)", () => {
  it("pending: «Отменить бронь» есть", () => {
    expect(renderBooking(makeBooking("pending"))).toContain("Отменить бронь");
  });

  it("cancelled: «Отменить бронь» нет", () => {
    expect(renderBooking(makeBooking("cancelled"))).not.toContain(
      "Отменить бронь",
    );
  });
});
