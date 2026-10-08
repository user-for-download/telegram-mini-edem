import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Trip } from "@edem/contracts";

import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { feedPerson, feedSeats } from "@/components/Trip/feedCardProps";

const AVATAR_SRC = "https://t.me/i/userpic/320/avatar.svg";

function makeTrip(): Trip {
  return {
    id: "trip-1",
    fromCity: "Москва",
    toCity: "Тула",
    date: "2026-09-20",
    time: "10:00",
    durationMinutes: 120,
    distanceKm: 180,
    price: 900,
    seatsTotal: 3,
    seatsAvailable: 2,
    // Флаги опций поездки обязательны в ОТВЕТЕ (tripSchema): неизвестное
    // значение ≠ «выключено», поэтому у фикстуры нет «дефолта».

    autoComplete: false,
    matchingEnabled: true,

    driver: {
      id: "u-driver",
      name: "Иван Водителев",
      avatar: AVATAR_SRC,
      rating: 4.8,
      reviewsCount: 12,
      tripsCount: 30,
      isVerified: true,
    },
    tags: [],
  };
}

describe("feedSeats: пилюля мест по остатку", () => {
  it("0 мест — «Мест нет», danger", () => {
    expect(feedSeats({ seatsAvailable: 0 })).toEqual({
      label: "Мест нет",
      tone: "danger",
    });
  });

  it("1 место — warning", () => {
    expect(feedSeats({ seatsAvailable: 1 })).toEqual({
      label: "Осталось мест: 1",
      tone: "warning",
    });
  });

  it("2+ места — success", () => {
    expect(feedSeats({ seatsAvailable: 2 })).toEqual({
      label: "Осталось мест: 2",
      tone: "success",
    });
  });
});

describe("feedPerson: персона ленты — водитель", () => {
  it("имя/аватар/рейтинг водителя; без авто — subtitle «Водитель»", () => {
    expect(feedPerson(makeTrip())).toEqual({
      name: "Иван Водителев",
      avatar: AVATAR_SRC,
      rating: 4.8,
      subtitle: "Водитель",
      showCarIcon: false,
    });
  });

  it("с авто — «модель · цвет» и иконка машины", () => {
    const trip: Trip = {
      ...makeTrip(),
      driver: {
        ...makeTrip().driver,
        car: { model: "Lada", color: "белая" },
      },
    };
    expect(feedPerson(trip)).toEqual({
      name: "Иван Водителев",
      avatar: AVATAR_SRC,
      rating: 4.8,
      subtitle: "Lada · белая",
      showCarIcon: true,
    });
  });
});

describe("лента на эталоне TripStandardCard", () => {
  it("имя водителя, src аватара, маршрут и пилюля мест на месте", () => {
    const trip = makeTrip();
    const seats = feedSeats(trip);
    const html = renderToString(
      <AppRoot platform="base">
        <TripStandardCard
          tripId={trip.id}
          fromCity={trip.fromCity}
          toCity={trip.toCity}
          headerStatus={
            <StatusPill tone={seats.tone}>{seats.label}</StatusPill>
          }
          person={feedPerson(trip)}
          onOpen={() => {}}
        />
      </AppRoot>,
    );

    expect(html).toContain("Иван Водителев");
    expect(html).toContain(AVATAR_SRC);
    expect(html).toContain("Москва");
    expect(html).toContain("Тула");
    // Открытие поездки — НАСТОЯЩАЯ кнопка: фокус, Enter/Space и роль
    // без ручных tabIndex/onKeyDown.
    expect(html).toContain("<button");
    expect(html).toContain("Открыть поездку");
    expect(html).toContain("Осталось мест:");
    expect(html).toContain('data-tone="success"');
  });
});
