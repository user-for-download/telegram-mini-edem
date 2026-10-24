// @vitest-environment jsdom
// F20: комментарий водителя — свободный текст человека (контракт допускает
// 500 знаков, packages/contracts/src/dto/trip.dto.ts), а рендерился он голым
// текстовым узлом внутри `.noteCard` — правила переносов там нет.
//
// Было: `white-space: normal`, поэтому перенос, набранный водителем, схлопывался
// в одну строку, а длинное слово без пробела (ссылка, имя файла) выдавливало
// блок. Стало: слова водителя идут через фасад `ui/Blockquote`, как жалоба,
// ответ модерации и «О себе» (ui/README, реестр #35).
//
// ЧТО ИМЕННО ПРОВЕРЯЕМ: узел, который НЕСЁТ ТЕКСТ, имеет класс `.quote` из
// ui/ui.module.css. Это единственное, что видно в jsdom, — и именно оно
// отличает старую версию от новой: правило `.quote` (pre-wrap +
// overflow-wrap) закреплено отдельно в ui/__tests__/blockquoteWrapping.test.ts.
// САМ ВИЗУАЛЬНЫЙ ИТОГ (перенос строки на экране, отсутствие вылезающего за
// плашку слова) в jsdom не проверяемый в принципе — это работа e2e.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { TripConditions } from "@/pages/TripDetails/TripHero";
import uiStyles from "@/ui/ui.module.css";
import detailStyles from "../TripDetailsPage.module.css";
import type { Trip } from "@edem/contracts";

// RTL auto-cleanup в проекте выключен (globals не заданы) — убираем дерево руками.
afterEach(cleanup);

const QUOTE_CLASS: string = uiStyles.quote as string;

/** Перенос строки и длинный токен без пробела — два настоящих случая F20. */
const COMMENT =
  "первая строка\nвторая строка\nhttps://example.com/" +
  "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function makeTrip(comment: string): Trip {
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
    driver: {
      id: "u-driver",
      name: "Иван Водителев",
      rating: 4.9,
      reviewsCount: 7,
      isVerified: true,
    },
    tags: [],
    status: "active",
    comment,
    bookedSeats: [],
    myBooking: null,
  } as unknown as Trip;
}

function renderHero(comment: string): HTMLElement {
  const { container } = render(
    <AppRoot platform="base">
      <TripConditions item={makeTrip(comment)} />
    </AppRoot>,
  );
  return container;
}

/**
 * Узел-родитель ТЕКСТОВОГО узла комментария — а не «div, внутри которого
 * есть этот текст». Именно на этом узле сидит класс плашки: искать по
 * textContent нельзя, там подошёл бы и внешний контейнер с подписью
 * «Комментарий водителя:».
 */
function commentTextParent(container: HTMLElement): HTMLElement {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue === COMMENT) {
      const parent = node.parentElement;
      if (parent === null) throw new Error("у текста комментария нет родителя");
      return parent;
    }
  }
  throw new Error("текст комментария не найден в DOM");
}

describe("TripHero: комментарий водителя идёт через ui/Blockquote", () => {
  it("узел, несущий текст комментария, имеет класс плашки .quote", () => {
    // ГЛАВНЫЙ пин F20. До правки здесь был `.noteCard` — обычный div без
    // правил переносов, и проверка падала.
    const container = renderHero(COMMENT);
    expect(commentTextParent(container).classList.contains(QUOTE_CLASS)).toBe(
      true,
    );
  });

  it("переносы, набранные водителем, доезжают до DOM как есть", () => {
    // Обрезать или схлопнуть их нельзя: это единственный носитель смысла
    // («объезд», «спизди с трассы» — в одну строку читается иначе).
    const container = renderHero(COMMENT);
    expect(commentTextParent(container).textContent).toBe(COMMENT);
  });

  it("комментарий в 500 знаков (предел контракта) выводится целиком", () => {
    // Обрезка «длинного» текста молча выглядела бы как аккуратность, а по
    // контракту это данные водителя: их режет только backend-схема.
    const long = `${COMMENT}${"я".repeat(500 - COMMENT.length)}`;
    expect(long).toHaveLength(500);
    const container = renderHero(long);
    const parent = (() => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue === long) {
          if (node.parentElement === null) throw new Error("нет родителя");
          return node.parentElement;
        }
      }
      throw new Error("текст комментария не найден в DOM");
    })();
    expect(parent.textContent).toBe(long);
    expect(parent.classList.contains(QUOTE_CLASS)).toBe(true);
  });

  it("длинный комментарий раскрывается и сворачивается без потери текста", () => {
    const long = "Подробности поездки. ".repeat(20);
    const container = renderHero(long);
    const quote = container.querySelector(`.${QUOTE_CLASS}`)!;
    const toggle = screen.getByRole("button", { name: "Читать полностью" });
    expect(quote.classList.contains(detailStyles.noteClamp!)).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(quote.classList.contains(detailStyles.noteClamp!)).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Свернуть");
    expect(quote.textContent).toBe(long);

    fireEvent.click(toggle);
    expect(quote.classList.contains(detailStyles.noteClamp!)).toBe(true);
    expect(quote.textContent).toBe(long);
  });

  it("короткий комментарий не требует раскрытия", () => {
    renderHero(COMMENT);
    expect(screen.queryByRole("button", { name: "Читать полностью" })).toBeNull();
  });
});
