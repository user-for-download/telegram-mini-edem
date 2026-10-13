// SSR-тесты рейтинга водителя в TripHero: без отзывов — прочерк «—»,
// а не мнимое 5.0 нового аккаунта (контракт отдаёт rating обязательным
// числом, app.md §5 — formatRating). Счётчик «(N отзывов)» — всегда.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { TripHero } from "@/pages/TripDetails/TripHero";
import type { Trip } from "@edem/contracts";

function makeTrip(driver: Record<string, unknown>): Trip {
  return {
    id: "t-1",
    fromCity: "Москва",
    toCity: "Тула",
    fromAddress: "м. Тёплый Стан",
    toAddress: "пр-т Ленина",
    date: "1 июня 2030",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 150,
    distanceKm: 180,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver,
    tags: [],
    status: "active",
    bookedSeats: [],
    myBooking: null,
  } as unknown as Trip;
}

function render(driver: Record<string, unknown>): string {
  return renderToString(
    <AppRoot platform="base">
      <TripHero
        item={makeTrip(driver)}
        shareStatus={null}
        isConfirmedBooking={false}
        hasActiveBooking={false}
        arrival="12:30"
        onShare={() => {}}
      />
    </AppRoot>,
  );
}

// SSR разбивает текст комментариями («7<!-- --> <!-- -->отзывов»),
// поэтому счётчик проверяем на склеенной строке.
function text(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

describe("TripHero: рейтинг водителя", () => {
  it("новый водитель (5.0 при нуле отзывов) — прочерк, а не 5.0", () => {
    const html = render({
      id: "u-driver",
      name: "Иван Водителев",
      rating: 5,
      reviewsCount: 0,
    });
    expect(html).toContain("—");
    expect(html).not.toContain("5.0");
    expect(text(html)).toContain("0 отзывов");
  });

  it("водитель с отзывами — число с точкой и склонение", () => {
    const html = render({
      id: "u-driver",
      name: "Иван Водителев",
      rating: 4.9,
      reviewsCount: 7,
    });
    expect(html).toContain("4.9");
    expect(text(html)).toContain("7 отзывов");
    expect(html).not.toContain("—");
  });

  it("обнулённый рейтинг после удаления отзывов — прочерк", () => {
    const onShare = vi.fn();
    const html = renderToString(
      <AppRoot platform="base">
        <TripHero
          item={makeTrip({
            id: "u-driver",
            name: "Иван Водителев",
            rating: 0,
            reviewsCount: 0,
          })}
          shareStatus={null}
          isConfirmedBooking={false}
          hasActiveBooking={false}
          arrival="12:30"
          onShare={onShare}
        />
      </AppRoot>,
    );
    expect(html).toContain("—");
    expect(html).not.toContain("0.0");
  });
});
