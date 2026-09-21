// Рендер-тесты профиля: шапка с рейтингом/статистикой, секции настроек,
// терминальные экраны бана/удаления. Отзывная вкладка и формы валидации
// покрыты в reviewsPage.test.tsx / profileForm.test.ts — здесь не дублируются.
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(queryState({ data: null }));
  mockUseProfileUpdate.mockReturnValue(mutation());
  mockUseLogout.mockReturnValue(mutation());
  mockUseDeleteAccount.mockReturnValue(mutation());
  mockUseUserReviews.mockReturnValue(infiniteState([]));
});

const {
  mockUseProfile,
  mockUseProfileUpdate,
  mockUseLogout,
  mockUseDeleteAccount,
  mockUseUserReviews,
  mockUseNotifSettings,
} = vi.hoisted(() => ({
  mockUseProfile: vi.fn(),
  mockUseProfileUpdate: vi.fn(),
  mockUseLogout: vi.fn(),
  mockUseDeleteAccount: vi.fn(),
  mockUseUserReviews: vi.fn(),
  mockUseNotifSettings: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
  useProfileUpdateMutation: mockUseProfileUpdate,
  useLogoutMutation: mockUseLogout,
  useDeleteAccountMutation: mockUseDeleteAccount,
  useProfileNotificationSettingsMutation: mockUseNotifSettings,
}));

vi.mock("@/queries/useReviewsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useReviewsQuery")>();
  return {
    ...original,
    useUserReviewsInfiniteQuery: mockUseUserReviews,
  };
});

import { ApiError } from "@/api/client";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import { ToastProvider } from "@/components/Toast/ToastProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

function infiniteState(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    ...queryState(),
    data: { pages: [{ items, pagination: { hasMore: false } }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  };
}

function render(element: ReactNode): string {
  // QueryClient — как AppConfig в проде: FeedbackModal всегда смонтирован
  // и тянет useCreateFeedbackMutation → useQueryClient.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return renderToString(
    <AppRoot platform="base">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/profile"]}>
          <ToastProvider>{element}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Александр",
    avatar: "https://t.me/i/userpic/320/x.svg",
    about: "За рулём 7 лет",
    rating: 4.9,
    reviewsCount: 12,
    tripsCount: 42,
    notificationsEnabled: true,
    car: { model: "Octavia", color: "Серебристый" },
    ...overrides,
  };
}

describe("ProfilePage header", () => {
  it("шапка с рейтингом, статистикой и верификацией", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Александр");
    expect(html).toContain("4.9");
    expect(html).toContain("Telegram верифицирован");
    expect(html).toContain("Поездок");
    expect(html).toContain("42");
    expect(html).toContain("Редактировать профиль");
  });

  it("секции настроек: авто, уведомления, поддержка, опасная зона", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Настройки и авто");
    expect(html).toContain("Автомобиль");
    expect(html).toContain("Octavia");
    expect(html).toContain("Служба поддержки");
    expect(html).toContain("Жалобы");
    expect(html).toContain("Выйти");
    expect(html).toContain("Удалить профиль");
    // Переключатели из эталона: тема + уведомления и звуки.
    expect(html).toContain("Внешний вид");
    expect(html).toContain("Тёмная тема");
    expect(html).toContain("Уведомления и звуки");
    expect(html).toContain("Звуковые эффекты");
  });

  it("без авто — CTA добавления", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: makeProfile({ car: null }) }),
    );
    const html = render(<ProfilePage />);
    expect(html).toContain("Добавить автомобиль");
  });
});

describe("ProfilePage terminal states", () => {
  it("403 удалённого аккаунта — экран «Профиль удалён»", () => {
    mockUseProfile.mockReturnValue(
      queryState({
        data: undefined,
        isError: true,
        error: new ApiError("Account is deleted", "FORBIDDEN", 403),
      }),
    );
    const html = render(<ProfilePage />);
    expect(html).toContain("Профиль удалён");
  });

  it("403 бана — экран «Аккаунт заблокирован»", () => {
    mockUseProfile.mockReturnValue(
      queryState({
        data: undefined,
        isError: true,
        error: new ApiError("Account is banned", "FORBIDDEN", 403),
      }),
    );
    const html = render(<ProfilePage />);
    expect(html).toContain("Аккаунт заблокирован");
  });

  it("409 удаления — подсказка про активные обязательства", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    mockUseDeleteAccount.mockReturnValue(
      mutation({
        error: new ApiError(
          "Active obligations",
          "ACCOUNT_HAS_ACTIVE_OBLIGATIONS",
          409,
        ),
      }),
    );
    const html = render(<ProfilePage />);
    expect(html).toContain("Завершите активные поездки");
  });
});
