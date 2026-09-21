// Рендер-тесты тела окна подтверждения заявки водителя:
// досье пассажира (ФИО, место, комментарий), тексты кнопок под действие,
// фолбэк пустого комментария. Паттерн tripStandardCard.test.tsx
// (SSR, без testing-library; Modal-портал не тестируем — только тело).
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { RequestConfirmBody } from "@/components/Trip/RequestConfirmDialog";

function render(element: ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    seat: 2,
    status: "pending",
    trip: { id: "t-1" },
    passenger: { name: "Пётр", rating: 4.8 },
    comment: "еду с рюкзаком",
    ...overrides,
  } as Parameters<typeof RequestConfirmBody>[0]["booking"];
}

const noop = () => {};

describe("RequestConfirmBody", () => {
  it("confirm: ФИО, место, комментарий, кнопка «Подтвердить»", () => {
    const html = render(
      <RequestConfirmBody
        booking={makeBooking()}
        action="confirmed"
        pending={false}
        onClose={noop}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain("Пётр");
    expect(html).toContain("место №2");
    expect(html).toContain("Комментарий пассажира");
    expect(html).toContain("еду с рюкзаком");
    expect(html).toContain("Подтвердить");
    expect(html).toContain("Назад");
    expect(html).not.toContain("Отклонить");
  });

  it("declined: кнопка «Отклонить»", () => {
    const html = render(
      <RequestConfirmBody
        booking={makeBooking()}
        action="declined"
        pending={false}
        onClose={noop}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain("Пётр");
    expect(html).toContain("Отклонить");
    expect(html).toContain("Назад");
    expect(html).not.toContain("Подтвердить");
  });

  it("пустой комментарий — «Без комментария»", () => {
    const html = render(
      <RequestConfirmBody
        booking={makeBooking({ comment: "   " })}
        action="confirmed"
        pending={false}
        onClose={noop}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain("Без комментария");
  });

  it("без комментария и рейтинга — ничего не ломается", () => {
    const booking = makeBooking();
    const { comment: _dropped, ...rest } = booking as Record<string, unknown>;
    void _dropped;
    const html = render(
      <RequestConfirmBody
        booking={
          {
            ...rest,
            passenger: { name: "Анна" },
          } as Parameters<typeof RequestConfirmBody>[0]["booking"]
        }
        action="declined"
        pending={false}
        onClose={noop}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain("Анна");
    expect(html).toContain("Без комментария");
    expect(html).not.toContain("undefined");
  });
});
