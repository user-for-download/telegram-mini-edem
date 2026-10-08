// @vitest-environment jsdom
// CTA «Ищу попутку» на главной открывает всплывающее окно создания заявки,
// а не страницу истории: создание — быстрое действие, список живёт отдельно
// («История запросов» в профиле).
//
// SSR-тест главной (HomePage.test.tsx) проверяет наличие кнопки, но не
// открытие окна: там нет кликов, а здесь портал ещё и не переживает jsdom
// (tgui `useAppRootContext` падает вне провайдера в портале). Поэтому окно
// замокано маркером: проверяем контракт главной (кнопка → open), а саму форму
// тестирует SSR-тест RideRequestCreateForm и живая проверка в браузере.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
// Лента заявок попутчиков на главной — тоже нужен мок: без него хук уходит в
// useQuery, которому на странице теста нечем кормить (нет QueryClientProvider).
vi.mock("@/queries/useRideRequestsQuery", () => ({
  useRideRequestFeedQuery: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
// Окно создания монтируется порталом, который в jsdom не переживает контекст
// AppRoot (tgui useAppRootContext) — замокано маркером: проверяем контракт
// главной, форму тестируют SSR-тесты и браузер.
vi.mock("@/components/Trip/RideRequestCreateModal", () => ({
  RideRequestCreateModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-request-modal" /> : null,
}));
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
  it("открывает окно создания заявки, а не уводит со страницы", () => {
    render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/"]}>
          <HomePage />
        </MemoryRouter>
      </AppRoot>,
    );

    // До клика окно закрыто.
    expect(screen.queryByTestId("create-request-modal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ищу попутку/ }));

    // Окно — состояние, а не роут: маркер появился, адрес не сменился.
    expect(screen.getByTestId("create-request-modal")).toBeTruthy();
  });

  it("кнопка водительского CTA не открывает окно заявки", () => {
    // Регресс на смешение двух сценариев, если их CTA когда-нибудь объединят.
    render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/"]}>
          <HomePage />
        </MemoryRouter>
      </AppRoot>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Создать поездку/ }));

    expect(screen.queryByTestId("create-request-modal")).toBeNull();
  });
});
