// @vitest-environment jsdom
// Фон под шторкой деталей поездки (/trips/:tripId): «Поиск» должен быть
// отрисован ОТКРЫТЫМ, а не в `<div aria-hidden hidden>` — иначе под шторкой
// остаётся пустота, а страница выпадает из дерева доступности. Инвариант тот
// же, что у шторок профиля (Profile/__tests__/routeBackground.test.tsx).
//
// DOM, а не SSR: проверяется структура дерева вокруг SearchPage. Сами шторки
// замоканы — тест про обёртку роута, а не про их содержимое.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

vi.mock("@/pages/Search/SearchPage", () => ({
  SearchPage: () => <div data-testid="search-bg">Поиск</div>,
}));

vi.mock("@/pages/TripDetails/TripDetailsPage", () => ({
  TripDetailsPage: () => <div data-testid="trip-details">Детали</div>,
}));

import { TripDetailsRoute } from "@/components/Trip/TripDetailsModal";

afterEach(cleanup);

function renderRoute() {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/trips/trip-1"]}>
        <TripDetailsRoute />
      </MemoryRouter>
    </AppRoot>,
  );
}

describe("фон под шторкой деталей поездки", () => {
  it("«Поиск» отрисован, а не пустота", () => {
    renderRoute();
    // Регрессия «под шторкой чёрный прямоугольник»: фон обязан нести
    // содержимое, а не висеть пустым контейнером.
    expect(screen.getByTestId("search-bg").textContent).toBe("Поиск");
  });

  it("фон не выключен из отрисовки атрибутом hidden", () => {
    renderRoute();
    // Проверяем именно `hidden`, а не aria-hidden: пока шторка открыта, кит
    // (Radix Dialog внутри Modal) САМ ставит aria-hidden фону — так и должно
    // быть, модалка действительно модальная. А вот `hidden` — наш былой способ
    // спрятать фон, и он включал display:none плюс выкидывал страницу из
    // дерева доступности.
    expect(screen.getByTestId("search-bg").closest("[hidden]")).toBeNull();
  });
});
