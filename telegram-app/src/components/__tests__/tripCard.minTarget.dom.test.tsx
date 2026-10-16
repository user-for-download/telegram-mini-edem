// @vitest-environment jsdom
// F25: кнопки «Поделиться поездкой» в TripCard были `IconButton size="s"`
// без MIN_TARGET — кит даёт им `padding:6px` + иконка 15px, то есть тап-таргет
// ~27×27px. Это и WCAG 2.5.8 AA (минимум 24px — формально проходит), и
// моторная доступность: палец не попадает в иконку с первого раза.
//
// Конвенция репозитория уже задана: DriverTripRequests.tsx:211,224 поднимает
// ровно такие же `IconButton size="s"` до 44px через `className={MIN_TARGET}`.
// Кнопка «поделиться» была исключением из правила, а не сознательным выбором.
//
// ПОЧЕМУ УТВЕРЖДАЕМ КЛАСС, А НЕ РАЗМЕР: jsdom не выполняет layout и не
// каскадирует CSS-модули (vitest по умолчанию отдаёт CSS-модули
// proxy-объектом, где `styles.minTarget` → `"minTarget"`), поэтому
// `getComputedStyle(el).minHeight` здесь всегда "" и измерить 44px в тесте
// физически нельзя. Единственная проверяемая в jsdom проекция требования —
// наличие класса MIN_TARGET на самом рендер-элементе: он и есть носитель
// `min-height: 44px` (ui/text.module.css:51-53). Смысл правила целиком в CSS,
// а не в пропе компонента: тот же приём уже запинен в
// components/__tests__/targetSizes.test.tsx.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { TripCard } from "@/components/Trip/TripCard";
import { MIN_TARGET } from "@/ui/classes";
import type { PassengerBooking, Trip } from "@edem/contracts";

afterEach(cleanup);

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
    autoComplete: false,
    matchingEnabled: true,
    driver: DRIVER,
    tags: [],
    status: "active",
    pendingRequestsCount: 0,
    confirmedBookingsCount: 1,
    ...overrides,
  };
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

function renderCard(variant: React.ComponentProps<typeof TripCard>["variant"]) {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/bookings"]}>
        <TripCard variant={variant} />
      </MemoryRouter>
    </AppRoot>,
  );
}

/** Кнопка «Поделиться поездкой» — единственная с таким доступным именем. */
function shareButton(): HTMLElement {
  const [button] = screen.getAllByRole("button", { name: "Поделиться поездкой" });
  expect(button).toBeDefined();
  return button as HTMLElement;
}

describe("TripCard: таргет кнопки «Поделиться поездкой»", () => {
  it("driving-вариант: кнопка несёт MIN_TARGET", () => {
    renderCard({
      kind: "driving",
      trip: makeTrip({ status: "active" }),
      onCancel: () => {},
      cancelPending: false,
    });

    expect(shareButton().className.split(/\s+/)).toContain(MIN_TARGET);
  });

  it("booking-вариант: кнопка несёт MIN_TARGET", () => {
    renderCard({
      kind: "booking",
      booking: makeBooking("confirmed"),
      onCancel: () => {},
      cancelPending: false,
    });

    expect(shareButton().className.split(/\s+/)).toContain(MIN_TARGET);
  });

  // Класс — единственное, что поднимает таргет; если бы он пропал, а
  // соседняя «Отменить» осталась бы 44px, рассинхрон вернулся бы незаметно.
  it("обе кнопки в футере одной карточки — 44px", () => {
    renderCard({
      kind: "booking",
      booking: makeBooking("pending"),
      onCancel: () => {},
      cancelPending: false,
    });

    const cancel = screen.getByRole("button", { name: "Отменить бронь" });
    expect(cancel.className.split(/\s+/)).toContain(MIN_TARGET);
    expect(shareButton().className.split(/\s+/)).toContain(MIN_TARGET);
  });

  // MIN_TARGET правит ТОЛЬКО высоту (min-height:44px), ширину и вид не трогает:
  // иконка 15px + padding к остаются, фон/рамки/цвета — те же. Поэтому
  // «поделиться» не расползается по ширине ряда и карточка не едет.
  it("класс не добавляет к кнопке ничего, кроме самого себя", () => {
    renderCard({
      kind: "driving",
      trip: makeTrip({ status: "active" }),
      onCancel: () => {},
      cancelPending: false,
    });

    const classes = shareButton().className.split(/\s+/).filter(Boolean);
    // Хэш-классы кита (mode/size) + ровно один наш MIN_TARGET.
    expect(classes.filter((name) => name === MIN_TARGET)).toHaveLength(1);
    expect(classes.length).toBeGreaterThan(1);
  });
});
