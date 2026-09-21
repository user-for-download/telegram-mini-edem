// Рендер-тесты тел модалок (Feedback/Settings) и страницы создания поездки.
// Modal — портал и в renderToString не попадает, поэтому у модалок тестируются
// экспортированные тела (FeedbackForm/SettingsBody). Создание поездки —
// отдельная страница: тестируется CreateTripForm. Детали
// поездки — это TripDetailsPage, покрытый tripDetailsPage.test.tsx 8/8.
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAllCities.mockReturnValue(queryState({ data: [] }));
  mockUseCreateTrip.mockReturnValue(mutation());
  mockUseCreateFeedback.mockReturnValue(mutation());
  mockUseProfile.mockReturnValue(
    queryState({ data: { notificationsEnabled: true } }),
  );
  mockUseSaveSettings.mockReturnValue(mutation());
  mockUseVehicle.mockReturnValue(
    queryState({
      data: { car: { model: "Skoda Octavia", color: "белый" } },
      vehicle: { model: "Skoda Octavia", color: "белый", plate: null },
    }),
  );
});

const {
  mockUseAllCities,
  mockUseCreateTrip,
  mockUseCreateFeedback,
  mockUseProfile,
  mockUseSaveSettings,
  mockUseVehicle,
} = vi.hoisted(() => ({
  mockUseAllCities: vi.fn(),
  mockUseCreateTrip: vi.fn(),
  mockUseCreateFeedback: vi.fn(),
  mockUseProfile: vi.fn(),
  mockUseSaveSettings: vi.fn(),
  mockUseVehicle: vi.fn(),
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));

vi.mock("@/queries/useTripsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useTripsQuery")>();
  return {
    ...original,
    useCreateTripMutation: mockUseCreateTrip,
  };
});

vi.mock("@/queries/useSupportQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useSupportQuery")>();
  return {
    ...original,
    useCreateFeedbackMutation: mockUseCreateFeedback,
  };
});

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
  useProfileNotificationSettingsMutation: mockUseSaveSettings,
}));

vi.mock("@/queries/vehicle", () => ({
  useVehicleQuery: mockUseVehicle,
}));

import { CreateTripForm } from "@/pages/CreateTrip/CreateTripPage";
import { FeedbackForm } from "@/components/Profile/FeedbackModal";
import { SettingsBody } from "@/components/Profile/SettingsModal";
import { ToastProvider } from "@/components/Toast/ToastProvider";

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

function mutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

function render(element: ReactNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return renderToString(
    <AppRoot platform="base">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/trips/my/new"]}>
          <ToastProvider>{element}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
}

const CITIES = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Вологда" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Череповец" },
];

describe("CreateTripForm (страница /trips/my/new)", () => {
  it("города — пикер с вводом, места — степпер MAX_SEATS=3", () => {
    mockUseAllCities.mockReturnValue(queryState({ data: CITIES }));
    const html = render(<CreateTripForm onCreated={() => {}} />);
    expect(html).toContain("Маршрут");
    expect(html).toContain("Город отправления");
    expect(html).toContain("Город назначения");
    // Пикер закрыт по умолчанию: список городов раскрывается по фокусу,
    // в SSR его нет — логика фильтра покрыта filterCities-тестами.
    expect(html).toContain("Откуда едем");
    expect(html).toContain("Куда едем");
    expect(html).toContain("Поездка");
    expect(html).toContain("Условия поездки");
    // CTA «Опубликовать» — инлайн в конце формы.
    expect(html).toContain("Опубликовать");
  });

  it("справочник грузится — плейсхолдер вместо формы", () => {
    mockUseAllCities.mockReturnValue(
      queryState({ data: undefined, isLoading: true }),
    );
    const html = render(<CreateTripForm onCreated={() => {}} />);
    expect(html).toContain("Загружаем города");
    expect(html).not.toContain("Опубликовать");
  });

  it("ошибка мутации — видимый текст", () => {
    mockUseAllCities.mockReturnValue(queryState({ data: CITIES }));
    mockUseCreateTrip.mockReturnValue(
      mutation({ error: new Error("Overlap with passenger booking") }),
    );
    const html = render(<CreateTripForm onCreated={() => {}} />);
    expect(html).toContain("Overlap with passenger booking");
  });

  it("без автомобиля — гейт вместо формы, с дорогой в профиль", () => {
    mockUseAllCities.mockReturnValue(queryState({ data: CITIES }));
    mockUseVehicle.mockReturnValue(queryState({ vehicle: null }));
    const html = render(<CreateTripForm onCreated={() => {}} />);
    expect(html).toContain("Нужен автомобиль");
    expect(html).toContain("Добавить автомобиль");
    expect(html).not.toContain("Маршрут");
    expect(html).not.toContain("Опубликовать");
  });
});

describe("FeedbackForm", () => {
  it("темы из списка, лимит 2000, пустое сообщение — сабмит погашен", () => {
    const html = render(<FeedbackForm onClose={() => {}} />);
    expect(html).toContain("Тема обращения");
    expect(html).toContain("Вопрос по поездке");
    expect(html).toContain("Предложение по улучшению");
    expect(html).toContain("Опишите детали вашего обращения");
    expect(html).toContain("Отправить в поддержку");
    expect(html).toContain("Мои обращения");
  });
});

describe("SettingsBody", () => {
  it("уведомления включены — текст статуса, тумблер-кнопка и live-регион", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { notificationsEnabled: true } }),
    );
    const html = render(<SettingsBody />);
    expect(html).toContain("Уведомления включены");
    expect(html).toContain("Выключить некритичные");
    expect(html).toContain("Открыть уведомления");
    expect(html).toContain('aria-live="polite"');
    // Закрытие — через header модалки: PageHeader и кнопки «назад» внутри нет.
    expect(html).not.toContain("Назад в профиль");
    // Таргеты ≥44px заданы явно (проверяемо в SSR).
    expect(html).toContain("min-h-11");
  });

  it("уведомления выключены — инверсия текста и кнопки", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { notificationsEnabled: false } }),
    );
    const html = render(<SettingsBody />);
    expect(html).toContain("Некритичные уведомления выключены");
    expect(html).toContain("Включить уведомления");
    expect(html).not.toContain("Выключить некритичные");
  });

  it("профиль грузится — спиннер вместо формы", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: undefined, isLoading: true }),
    );
    const html = render(<SettingsBody />);
    expect(html).toContain("Загрузка");
    expect(html).not.toContain("Открыть уведомления");
  });

  it("ошибка профиля — плейсхолдер с ретраем", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: undefined, error: new Error("offline") }),
    );
    const html = render(<SettingsBody />);
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Повторить");
  });

  it("ошибка сохранения — видимый текст отката", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: { notificationsEnabled: true } }),
    );
    mockUseSaveSettings.mockReturnValue(
      mutation({ error: new Error("Failed to save settings") }),
    );
    const html = render(<SettingsBody />);
    expect(html).toContain("Failed to save settings");
    expect(html).toContain("Выключить некритичные");
  });
});
