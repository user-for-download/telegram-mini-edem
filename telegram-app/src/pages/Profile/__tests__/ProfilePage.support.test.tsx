// @vitest-environment jsdom
// Пункт меню «Служба поддержки» ведёт на страницу /profile/support.
//
// Раньше он открывал шторку FeedbackModal с дублем формы обращения, которая
// сама вела на эту страницу (внутри шторки была даже кнопка «Мои обращения»).
// SSR-тест ProfilePage видит только наличие строки меню, но не её действие, —
// здесь клик и проверка маршрута.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

// Частичный мок: страница использует и useDeleteAccountMutation, кроме
// useProfileQuery — голый объект модуля рвал бы на отсутствующем экспорте.
vi.mock("@/queries/profile", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/profile")>();
  return {
    ...original,
    useProfileQuery: mockUseProfile,
    useDeleteAccountMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
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
// Частичный мок: jsdom-тесты других страниц (HomePage) добавляют useSignal и
// haptic; здесь нужен тот же набор, иначе модуль рвётся на отсутствующем
// экспорте.
vi.mock("@tma.js/sdk-react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tma.js/sdk-react")>();
  return {
    ...original,
    backButton: { onClick: vi.fn(), offClick: vi.fn() },
    hapticFeedback: {
      selectionChanged: { ifAvailable: vi.fn() },
      impactOccurred: { ifAvailable: vi.fn() },
      notificationOccurred: { ifAvailable: vi.fn() },
    },
    miniApp: { ready: { ifAvailable: vi.fn() }, isDark: () => false },
    // Конвенция из AppConfig.test.tsx: useSignal принимает замыкание-сигнал и
    // вызывает его. Реальная реализация в jsdom тянет getSnapshot и падает.
    useSignal: (signal: () => unknown) => signal(),
  };
});

import { ProfilePage } from "@/pages/Profile/ProfilePage";

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

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    name: "Александр",
    avatar: "https://t.me/a.png",
    rating: 4.8,
    reviewsCount: 3,
    notificationsEnabled: true,
    car: null,
    ...overrides,
  };
}

function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <AppRoot platform="base">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/profile"]}>
          <Routes>
            <Route path="/profile" element={<ProfilePage />} />
            <Route
              path="/profile/support"
              element={<div>Страница поддержки</div>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
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

describe("ProfilePage: пункт «Служба поддержки»", () => {
  it("открывает страницу /profile/support", () => {
    renderProfile();

    fireEvent.click(screen.getByText("Служба поддержки"));

    expect(screen.getByText("Страница поддержки")).toBeTruthy();
  });
});
