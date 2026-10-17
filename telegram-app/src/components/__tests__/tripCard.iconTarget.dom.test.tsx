// @vitest-environment jsdom
// F25: кнопки «Поделиться поездкой» в TripCard были `IconButton size="s"`
// без тап-таргета — кит даёт им `padding:6px` + иконка 15px, то есть ~27×27px.
// Это и WCAG 2.5.8 AA (минимум 24px — формально проходит), и моторная
// доступность: палец не попадает в иконку с первого раза.
//
// ПОЧЕМУ ICON_TARGET, А НЕ MIN_TARGET: MIN_TARGET поднимает только высоту.
// У IconButton кит рисует круг (border-radius:50%) и прижимает иконку к
// верхнему краю (inline-flex + align-items:stretch), поэтому 27×44 — это
// овал с иконкой не по центру. ICON_TARGET задаёт 44×44 и центрирование:
// круг остаётся кругом, иконка — в середине. Текстовые кнопки продолжают
// использовать MIN_TARGET (ширина 44 им не нужна).
//
// ПОЧЕМУ УТВЕРЖДАЕМ КЛАСС, А НЕ РАЗМЕР: jsdom не выполняет layout и не
// каскадирует CSS-модули (vitest по умолчанию отдаёт CSS-модули
// proxy-объектом, где `styles.iconTarget` → `"iconTarget"`), поэтому
// `getComputedStyle(el).minWidth` здесь всегда "" и измерить 44px в тесте
// физически нельзя. Единственная проверяемая в jsdom проекция требования —
// наличие класса ICON_TARGET на самом рендер-элементе: он и есть носитель
// `min-width/min-height: 44px` + центрирования (ui/text.module.css). Смысл
// правила целиком в CSS, а не в пропе компонента: тот же приём уже запинен
// в components/__tests__/targetSizes.test.tsx.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { TripCard } from "@/components/Trip/TripCard";
import { ICON_TARGET, MIN_TARGET } from "@/ui/classes";
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
  it("driving-вариант: кнопка несёт ICON_TARGET", () => {
    renderCard({
      kind: "driving",
      trip: makeTrip({ status: "active" }),
      onCancel: () => {},
      cancelPending: false,
    });

    expect(shareButton().className.split(/\s+/)).toContain(ICON_TARGET);
  });

  it("booking-вариант: кнопка несёт ICON_TARGET", () => {
    renderCard({
      kind: "booking",
      booking: makeBooking("confirmed"),
      onCancel: () => {},
      cancelPending: false,
    });

    expect(shareButton().className.split(/\s+/)).toContain(ICON_TARGET);
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
    expect(shareButton().className.split(/\s+/)).toContain(ICON_TARGET);
  });

  // ICON_TARGET держит квадрат 44×44 + центрирование иконки. MIN_TARGET на
  // иконке — регрессия «овал вместо круга», поэтому его быть НЕ должно.
  it("иконка получает ICON_TARGET и НЕ получает height-only MIN_TARGET", () => {
    renderCard({
      kind: "driving",
      trip: makeTrip({ status: "active" }),
      onCancel: () => {},
      cancelPending: false,
    });

    const classes = shareButton().className.split(/\s+/).filter(Boolean);
    expect(classes.filter((name) => name === ICON_TARGET)).toHaveLength(1);
    expect(classes).not.toContain(MIN_TARGET);
    // Хэш-классы кита (mode/size) + наш ICON_TARGET.
    expect(classes.length).toBeGreaterThan(1);
  });
});
