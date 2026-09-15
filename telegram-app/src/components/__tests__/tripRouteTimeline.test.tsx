// Рендер-тесты TripRouteTimeline без @testing-library/react (не установлен):
// react-dom/server renderToString + AppRoot — паттерн
// telegram-app/src/components/__tests__/lazyAvatar.test.tsx.
// Проверяется только обёртка, внутренности нативного tgui Timeline не тестируем.
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

  it("null addresses → meeting-point fallback hint for both stops", () => {
    const html = render({ fromAddress: null, toAddress: null });
    expect(html).toContain(FALLBACK);
    // Фолбэк встречается дважды — для отправления и прибытия.
    expect(html.split(FALLBACK).length - 1).toBe(2);
  });

  it("renders native Timeline list, not the manual border-l-2 rail", () => {
    const html = render();
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).not.toContain("border-l-2");
  });
});
