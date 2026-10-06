// @vitest-environment jsdom
// CTA «Ищу попутку» на главной ведёт в шторку заявок (/ride-requests).
//
// SSR-тест главной (HomePage.test.tsx) проверяет наличие кнопки, но не
// переход: там нет ни кликов, ни смены состояния роутера. Здесь jsdom и
// настоящий MemoryRouter с двумя маршрутами — иначе кнопка может быть
// нарисована и ничего не делать.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const {
  mockUseProfile,
  mockUseMyBookings,
  mockUseAllCities,
  mockUseDriverRequests,
  mockUseUpdateBookingStatus,
  mockUseMyTrips,
  mockUseVehicle,
} = vi.hoisted(() => ({
  mockUseProfile: vi.fn(),
  mockUseMyBookings: vi.fn(),
  mockUseAllCities: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseUpdateBookingStatus: vi.fn(),
  mockUseMyTrips: vi.fn(),
  mockUseVehicle: vi.fn(),
}));

vi.mock("@/queries/profile", () => ({ useProfileQuery: mockUseProfile }));
vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
  useDriverRequestsQuery: mockUseDriverRequests,
  useUpdateBookingStatusMutation: mockUseUpdateBookingStatus,
}));
vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));
vi.mock("@/queries/useTripsQuery", () => ({
  useInfiniteMyTripsQuery: mockUseMyTrips,
}));
vi.mock("@/queries/vehicle", () => ({ useVehicleQuery: mockUseVehicle }));
vi.mock("@tma.js/sdk-react", () => ({
  backButton: { onClick: vi.fn(), offClick: vi.fn() },
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
  },
  miniApp: { ready: { ifAvailable: vi.fn() } },
}));

import { HomePage } from "@/pages/HomePage/HomePage";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(queryState({ data: null }));
  mockUseMyBookings.mockReturnValue(queryState({ data: [] }));
  mockUseMyTrips.mockReturnValue(queryState({ data: undefined }));
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseDriverRequests.mockReturnValue(queryState({ data: [] }));
  mockUseUpdateBookingStatus.mockReturnValue({ mutate: vi.fn() });
  mockUseVehicle.mockReturnValue(
    queryState({ vehicle: { model: "Skoda", color: "белый" } }),
  );
});

afterEach(cleanup);

describe("HomePage: CTA «Ищу попутку»", () => {
  it("переводит на маршрут заявок /ride-requests", () => {
    render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/ride-requests" element={<div>Шторка заявок</div>} />
          </Routes>
        </MemoryRouter>
      </AppRoot>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ищу попутку/ }));

    expect(screen.getByText("Шторка заявок")).toBeTruthy();
  });

  it("кнопка водительского CTA остаётся отдельной: «Создать поездку» не ведёт в заявки", () => {
    // Регресс на смешение двух сценариев, если ихCTAкогда-нибудь объединят.
    render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/trips/my/new" element={<div>Форма поездки</div>} />
          </Routes>
        </MemoryRouter>
      </AppRoot>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Создать поездку/ }));

    expect(screen.getByText("Форма поездки")).toBeTruthy();
  });
});