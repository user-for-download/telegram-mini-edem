// P2 list-perf: useScrollRestore — save scrollTop по ключу маршрута,
// restore при возврате; интеграция в Shell. Паттерн TripsPage.test.tsx
// (SSR renderToString, без testing-library): эффекты в SSR не выполняются,
// поэтому решение перехода покрыто чистыми planRouteTransition/store,
// а рендер Shell с хуком — renderToString без window.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  clearScrollPositions();
});

vi.mock("@telegram-apps/sdk-react", () => ({
  backButton: {
    onClick: vi.fn(),
    offClick: vi.fn(),
    show: { ifAvailable: vi.fn() },
    hide: { ifAvailable: vi.fn() },
  },
  settingsButton: {
    show: { ifAvailable: vi.fn() },
    hide: { ifAvailable: vi.fn() },
    onClick: { ifAvailable: vi.fn() },
    offClick: { ifAvailable: vi.fn() },
  },
  useLaunchParams: () => ({}),
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
  },
}));

import {
  clearScrollPositions,
  planRouteTransition,
  readScrollPosition,
  routeScrollKey,
  saveScrollPosition,
  useScrollRestore,
} from "@/hooks/useScrollRestore";
import { Shell } from "@/router/AppRouter";

function Probe({ routeKey }: { routeKey: string }) {
  useScrollRestore(routeKey);
  return <div>probe:{routeKey}</div>;
}

function renderShell(url: string): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/trips" element={<div>Список поездок</div>} />
            <Route path="/trips/:tripId" element={<div>Модалка поездки</div>} />
            <Route path="*" element={<div>Фолбэк раздела</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppRoot>,
  );
}

describe("routeScrollKey", () => {
  it("путь без query — сам путь", () => {
    expect(routeScrollKey("/trips", "")).toBe("/trips");
    expect(routeScrollKey("/trips")).toBe("/trips");
  });

  it("сегменты списков различаются (query входит в ключ)", () => {
    expect(routeScrollKey("/bookings", "?segment=driver")).toBe(
      "/bookings?segment=driver",
    );
    expect(routeScrollKey("/bookings", "?segment=driver")).not.toBe(
      routeScrollKey("/bookings", "?segment=history"),
    );
  });
});

describe("scroll store", () => {
  it("happy: save → read возвращает scrollTop", () => {
    saveScrollPosition("/trips", 420);
    expect(readScrollPosition("/trips")).toBe(420);
  });

  it("edge: неизвестный ключ — undefined (прямой вход → наверх)", () => {
    expect(readScrollPosition("/trips")).toBeUndefined();
  });

  it("edge: пустой ключ игнорируется", () => {
    saveScrollPosition("", 100);
    expect(readScrollPosition("")).toBeUndefined();
  });

  it("edge: отрицательный scrollTop — кламп к 0, мусор — игнор", () => {
    saveScrollPosition("/trips", -50);
    expect(readScrollPosition("/trips")).toBe(0);
    saveScrollPosition("/bookings", Number.NaN);
    expect(readScrollPosition("/bookings")).toBeUndefined();
    saveScrollPosition("/profile", "100");
    expect(readScrollPosition("/profile")).toBeUndefined();
  });

  it("clear сбрасывает сохранения", () => {
    saveScrollPosition("/trips", 10);
    clearScrollPositions();
    expect(readScrollPosition("/trips")).toBeUndefined();
  });
});

describe("planRouteTransition", () => {
  it("happy: уход со списка сохраняет позицию, возврат — восстанавливает", () => {
    // Arrange: пользователь проскроллил список.
    // Act: уход в route-модалку.
    const leave = planRouteTransition("/trips", "/trips/t-1", 420);
    expect(leave.save).toEqual({ key: "/trips", top: 420 });
    expect(leave.restoreTop).toBe(0);
    expect(leave.shouldRestoreFocus).toBe(true);
    // Применяем сохранение и возвращаемся Back.
    if (leave.save) saveScrollPosition(leave.save.key, leave.save.top);
    const back = planRouteTransition("/trips/t-1", "/trips", 0);
    expect(back.restoreTop).toBe(420);
    expect(back.shouldRestoreFocus).toBe(true);
  });

  it("edge: первый монт — сохранять нечего, без позиции → наверх, фокус не трогаем", () => {
    const plan = planRouteTransition(null, "/trips", 0);
    expect(plan.save).toBeNull();
    expect(plan.restoreTop).toBe(0);
    expect(plan.shouldRestoreFocus).toBe(false);
  });

  it("edge: тот же ключ — без сохранения и без угона фокуса", () => {
    saveScrollPosition("/trips", 300);
    const plan = planRouteTransition("/trips", "/trips", 300);
    expect(plan.save).toBeNull();
    expect(plan.restoreTop).toBe(300);
    expect(plan.shouldRestoreFocus).toBe(false);
  });
});

describe("useScrollRestore SSR", () => {
  it("проба с хуком рендерится без window", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(<Probe routeKey="/trips" />);
    // renderToString вставляет комментарий между текстом и выражением.
    expect(html).toContain("probe:");
    expect(html).toContain("/trips");
  });

  it("Shell со списком: есть сохранённая позиция — рендер не падает", () => {
    saveScrollPosition("/trips", 420);
    const html = renderShell("/trips");
    expect(html).toContain("AppShell");
    expect(html).toContain("Список поездок");
  });

  it("Shell с модалкой поверх списка: рендер не падает, список под ней цел", () => {
    saveScrollPosition("/trips", 420);
    const html = renderShell("/trips/t-1");
    expect(html).toContain("AppShell");
    expect(html).toContain("Модалка поездки");
  });

  it("Shell без сохранений и с неизвестным ключом — рендер не падает", () => {
    const html = renderShell("/unknown-route");
    expect(html).toContain("AppShell");
    expect(html).toContain("Фолбэк раздела");
  });

  it("a11y: контент Shell — фокусируемый landmark для возврата фокуса", () => {
    const html = renderShell("/trips");
    expect(html).toContain("AppShell__content");
    expect(html).toContain('tabindex="-1"');
  });
});
