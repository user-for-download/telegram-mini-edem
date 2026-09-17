// SSR-тесты досье пассажира: тело модалки экспортировано отдельно
// (Modal — портал, в renderToString не попадает) — паттерн FeedbackModal.
// Тело — чистые props (без queries/роутера), поэтому рендерится напрямую.
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Booking, Review } from "@edem/contracts";
import { PassengerRequestModalBody } from "@/components/PassengerRequestModal";

function makeBooking(overrides: Record<string, unknown> = {}): Booking {
  return {
    id: "b-1",
    seat: 2,
    status: "pending",
    expiresAt: null,
    passenger: {
      id: "p-1",
      name: "Пётр",
      avatar: "https://t.me/p.png",
      rating: 4.9,
      reviewsCount: 3,
      tripsCount: 5,
    },
    trip: {
      id: "t-1",
      fromCity: "Вологда",
      toCity: "Череповец",
      fromAddress: "ул. Мира 1",
      toAddress: "ул. Ленина 2",
      date: "2030-06-01",
      time: "09:00",
      departureAt: "2030-06-01T09:00:00.000Z",
      durationMinutes: 120,
      distanceKm: 120,
      price: 450,
      seatsTotal: 4,
      seatsAvailable: 2,
      status: "active",
      driver: {
        name: "Я",
        avatar: "https://t.me/me.png",
        rating: 5,
        reviewsCount: 0,
        tripsCount: 0,
      },
      tags: [],
    },
    ...overrides,
  } as unknown as Booking;
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "r-1",
    targetRole: "passenger",
    rating: 5,
    text: "Отличный пассажир",
    status: "published",
    date: "1 мая 2030",
    tripRoute: "Вологда → Череповец",
    author: {
      id: "a-1",
      name: "Александр",
      avatar: "https://t.me/a.png",
      rating: 5,
      reviewsCount: 0,
      tripsCount: 0,
    },
    ...overrides,
  } as unknown as Review;
}

function render(element: ReactElement): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

describe("PassengerRequestModalBody", () => {
  it("показывает досье: имя, рейтинг, статистику, маршрут и места", () => {
    const html = render(
      <PassengerRequestModalBody
        booking={makeBooking()}
        onDecide={vi.fn()}
        busy={null}
        reviews={[]}
        reviewsLoading={false}
      />,
    );
    expect(html).toContain("Пётр");
    expect(html).toContain("4.9");
    expect(html).toContain("5 поездок");
    expect(html).toContain("3 отзывов");
    expect(html).toContain("Вологда → Череповец");
    expect(html).toContain("место №2");
    // Цена брони = цена места, без умножения на номер места.
    expect(html).toContain("450 ₽");
    expect(html).not.toContain("900");
  });

  it("показывает только отзывы о пассажире (targetRole=passenger), не о нём как водителе", () => {
    const html = render(
      <PassengerRequestModalBody
        booking={makeBooking()}
        onDecide={vi.fn()}
        busy={null}
        reviews={[
          makeReview({ id: "r-1", text: "Отличный пассажир" }),
          makeReview({
            id: "r-2",
            targetRole: "driver",
            text: "Отзыв о водителе",
          }),
        ]}
        reviewsLoading={false}
      />,
    );
    expect(html).toContain("Отличный пассажир");
    expect(html).not.toContain("Отзыв о водителе");
  });

  it("пустой список отзывов — секция не рендерится", () => {
    const html = render(
      <PassengerRequestModalBody
        booking={makeBooking()}
        onDecide={vi.fn()}
        busy={null}
        reviews={[]}
        reviewsLoading={false}
      />,
    );
    expect(html).not.toContain("Отзывы");
  });

  it("отзывы свернуты в аккордеон со счётчиком", () => {
    const html = render(
      <PassengerRequestModalBody
        booking={makeBooking()}
        onDecide={vi.fn()}
        busy={null}
        reviews={[
          makeReview({ id: "r-1", text: "Отличный пассажир" }),
          makeReview({ id: "r-2", text: "Вовремя пришёл" }),
        ]}
        reviewsLoading={false}
      />,
    );
    expect(html).toContain("Отзывы (2)");
    // Контент остаётся в DOM свернутым (aria-hidden) — тексты видны.
    expect(html).toContain("Отличный пассажир");
  });

  it("комментарий брони виден водителю", () => {
    const html = render(
      <PassengerRequestModalBody
        booking={makeBooking({ comment: "Буду с рюкзаком" })}
        onDecide={vi.fn()}
        busy={null}
        reviews={[]}
        reviewsLoading={false}
      />,
    );
    expect(html).toContain("Буду с рюкзаком");
  });

  it("кнопки блокируются на время мутации", () => {
    const html = render(
      <PassengerRequestModalBody
        booking={makeBooking()}
        onDecide={vi.fn()}
        busy="confirmed"
        reviews={[]}
        reviewsLoading={false}
      />,
    );
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
