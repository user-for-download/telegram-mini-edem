// Рендер-тесты TripRouteTimeline без @testing-library/react (не установлен):
// react-dom/server renderToString + AppRoot — паттерн
// telegram-app/src/components/__tests__/lazyAvatar.test.tsx.
//
// 2026-10-17 контракт изменился осознанно: раньше здесь стоял нативный
// tgui `Timeline`, и тест пинил `<ul>/<li>`. У `Timeline` padding 32px 44px
// и gap 24px — внутри карточки с паддингом 16 это давало 256px высоты на
// две строки маршрута и пустую полосу под адресом прибытия (треть
// карточки). Заменён на свой рельс ТОЙ ЖЕ геометрии, что у карточки поездки
// (кольцо → линия → заливка), но семантика списка сохранена: у маршрута
// есть порядок, поэтому это `<ol>`, а не набор div'ов.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

import {
  TripRouteTimeline,
  type TripRouteTimelineProps,
} from "@/components/TripRouteTimeline";

const FALLBACK = "Точное место встречи станет доступно после подтверждения брони";

function render(props: Partial<TripRouteTimelineProps> = {}): string {
  return renderToString(
    <AppRoot platform="base">
      <TripRouteTimeline
        fromCity="Москва"
        fromTime="09:30"
        toCity="Тверь"
        arrival="12:00"
        {...props}
      />
    </AppRoot>,
  );
}

describe("TripRouteTimeline", () => {
  it("renders 2 items with time · city headers", () => {
    const html = render({
      fromAddress: "м. Тёплый Стан",
      toAddress: "пр-т Ленина",
    });
    expect(html).toContain("09:30");
    expect(html).toContain("Москва");
    expect(html).toContain("12:00");
    expect(html).toContain("Тверь");
    expect(html).toContain("м. Тёплый Стан");
    expect(html).toContain("пр-т Ленина");
  });

  it("arrival=null → destination header falls back to city only", () => {
    const html = render({ arrival: null });
    expect(html).toContain("Тверь");
    expect(html).not.toContain("12:00");
    expect(html).toContain("09:30");
  });

  // Раньше подсказка повторялась ПОД КАЖДЫМ городом — два одинаковых
  // абзаца по три строки читались как ошибка и съедали пол-карточки.
  // Теперь она одна, под маршрутом.
  it("null addresses → одна подсказка на весь маршрут, а не две", () => {
    const html = render({ fromAddress: null, toAddress: null });
    expect(html).toContain(FALLBACK);
    expect(html.split(FALLBACK).length - 1).toBe(1);
  });

  it("маршрут — упорядоченный список (ol/li), время отдельной колонкой", () => {
    const html = render();
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
    // Самодельного tailwind-класса border-l-2 по-прежнему нет: рельс —
    // это CSS-модуль, а не утилиты.
    expect(html).not.toContain("border-l-2");
  });

  it("точка отправления — кольцо, прибытия — заливка", () => {
    const html = render();
    // Оба класса приходят из CSS-модуля: в SSR классы видны как имена
    // (CSS-модули отдают строку), поэтому проверяем по data-атрибуту
    // структуры, а не по хэшу кита.
    expect(html).toContain("dotFrom");
    expect(html).toContain("dotTo");
    expect(html).toContain("line");
  });
});
