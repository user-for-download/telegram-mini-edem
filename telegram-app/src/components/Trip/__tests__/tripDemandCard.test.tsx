// SSR-тесты карточки спроса на свою поездку (Слой 1a): заголовок с N из
// `items.length`, пустой ответ и ошибка (403 не-водителю, 404, сеть) →
// компонент возвращает null, как лента спроса на главной. Паттерн
// DriverTripRequests.test.tsx (SSR renderToString, мок хука через vi.hoisted).
// Ширина строк запинена чтением CSS-модуля MenuRow — ровно так же, как в
// ui/__tests__/menuRow.test.tsx: дефект виден только в браузере.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";
import type { RideRequest } from "@edem/contracts";

const { mockUseTripDemand, mockUseInvite } = vi.hoisted(() => ({
  mockUseTripDemand: vi.fn(),
  // Мутация приглашения — тоже хук, и строки рендерятся всегда: без заглушки
  // в моке карточка упала бы на отсутствующем экспорте модуля.
  mockUseInvite: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
}));

vi.mock("@/queries/useRideRequestsQuery", () => ({
  useTripDemandQuery: mockUseTripDemand,
  useInviteRideRequestMutation: mockUseInvite,
}));

import {
  TripDemandCard,
  demandTitle,
  demandWindow,
} from "@/components/Trip/TripDemandCard";
import { ToastProvider } from "@/components/Toast/ToastProvider";

const menuRowCss = readFileSync(
  fileURLToPath(new URL("../../../ui/MenuRow.module.css", import.meta.url)),
  "utf8",
);

const DEMAND_TITLE = "ищут попутку по твоему маршруту";

function rideRequest(overrides: Partial<RideRequest> = {}): RideRequest {
  return {
    id: "r-1",
    fromCity: { id: "c-1", name: "Вологда" },
    toCity: { id: "c-2", name: "Сокол" },
    earliestAt: "2030-06-02T05:00:00.000Z",
    latestAt: "2030-06-02T12:00:00.000Z",
    seats: 1,
    status: "active",
    expiresAt: "2030-06-01T05:00:00.000Z",
    createdAt: "2030-05-01T05:00:00.000Z",
    updatedAt: "2030-05-01T05:00:00.000Z",
    ...overrides,
  };
}

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

/** Без AppRoot: null-состояния обязаны давать ровно пустую строку. */
function renderBare(tripId = "t-1"): string {
  return renderToString(
    <MemoryRouter initialEntries={["/bookings?segment=driver"]}>
      <ToastProvider>
        <TripDemandCard tripId={tripId} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function renderCard(tripId = "t-1"): string {
  return renderToString(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/bookings?segment=driver"]}>
        <ToastProvider>
          <TripDemandCard tripId={tripId} />
        </ToastProvider>
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseTripDemand.mockReturnValue(queryState({ data: [] }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TripDemandCard: заголовок и строки", () => {
  it("N=3: число из items.length, строки — нативные кнопки MenuRow", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(
      queryState({
        data: [
          rideRequest({ id: "r-1", seats: 1 }),
          rideRequest({ id: "r-2", seats: 2 }),
          rideRequest({ id: "r-3", seats: 5 }),
        ],
      }),
    );

    // Act
    const html = renderCard();

    // Assert
    expect(html).toContain(`3 человека ${DEMAND_TITLE}`);
    expect(html).toContain("1 место");
    expect(html).toContain("2 места");
    expect(html).toContain("5 мест");
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(mockUseTripDemand).toHaveBeenCalledWith("t-1");
  });

  it("окно заявки по Москве, день один на обе границы", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(
      queryState({ data: [rideRequest()] }),
    );

    // Act
    const html = renderCard();

    // Assert: 05:00Z → 08:00 МСК, 12:00Z → 15:00 МСК.
    expect(html).toContain("2 июня, 08:00 — 15:00");
  });

  it("оговорка про верхнюю оценку обязательна: число людей не считается", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(
      queryState({ data: [rideRequest()] }),
    );

    // Act
    const html = renderCard();

    // Assert
    expect(html).toContain("Часть заявок может принадлежать одному человеку");
  });
});

describe("TripDemandCard: пусто, загрузка и ошибка — тишина", () => {
  it("N=0 — ничего не рендерим", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(queryState({ data: [] }));

    // Act
    const html = renderBare();

    // Assert
    expect(html).toBe("");
    expect(renderCard()).not.toContain(DEMAND_TITLE);
  });

  it("загрузка — null, без скелетона и заголовка", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(queryState({ isLoading: true }));

    // Act
    const html = renderBare();

    // Assert
    expect(html).toBe("");
    expect(renderCard()).not.toContain(DEMAND_TITLE);
  });

  it("403 (не водитель) — спроса нет: ни текста, ни «Повторить»", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(
      queryState({
        data: undefined,
        isError: true,
        error: new ApiError("Forbidden", "FORBIDDEN", 403),
      }),
    );

    // Act
    const html = renderCard();

    // Assert
    expect(html).not.toContain(DEMAND_TITLE);
    expect(html).not.toContain("Forbidden");
    expect(html).not.toContain("Повторить");
    expect(html).not.toContain('role="alert"');
  });

  it("404/сетевая ошибка — то же самое, экран не падает", () => {
    // Arrange
    mockUseTripDemand.mockReturnValue(
      queryState({
        data: undefined,
        isError: true,
        error: new ApiError("Trip not found", "NOT_FOUND", 404),
      }),
    );

    // Act
    const html = renderBare();

    // Assert
    expect(html).toBe("");
  });
});

describe("TripDemandCard: строки на всю ширину карточки", () => {
  it("width: 100% в ui/MenuRow — иначе подпись растёт за карточку", () => {
    expect(menuRowCss).toMatch(/\.row\s*\{[^}]*width:\s*100%/);
  });
});

describe("tripDemandCard: тексты (чистые функции)", () => {
  it("заголовок согласует слово и глагол по числу", () => {
    expect(demandTitle(1)).toBe("1 человек ищет попутку по твоему маршруту");
    expect(demandTitle(3)).toBe("3 человека ищут попутку по твоему маршруту");
    expect(demandTitle(5)).toBe("5 человек ищут попутку по твоему маршруту");
    expect(demandTitle(21)).toBe("21 человек ищет попутку по твоему маршруту");
  });

  it("окно через полночь печатает оба дня", () => {
    const request = rideRequest({
      earliestAt: "2030-06-02T21:00:00.000Z",
      latestAt: "2030-06-03T21:00:00.000Z",
    });

    expect(demandWindow(request)).toBe("3 июня, 00:00 — 4 июня, 00:00");
  });

  it("мусорные даты не дают «Invalid Date» в UI", () => {
    const request = rideRequest({ earliestAt: "не дата", latestAt: "не дата" });

    expect(demandWindow(request)).toBe("Окно поездки не задано");
  });
});
