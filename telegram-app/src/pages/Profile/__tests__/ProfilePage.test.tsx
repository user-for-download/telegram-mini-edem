// Рендер-тесты профиля: шапка с рейтингом/статистикой, секции настроек,
// терминальные экраны бана/удаления. Отзывная вкладка и формы валидации
// покрыты в reviewsPage.test.tsx / profileForm.test.ts — здесь не дублируются.
// Паттерн tripsPages.test.tsx (SSR, без testing-library).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProfile.mockReturnValue(queryState({ data: null }));
  mockUseProfileUpdate.mockReturnValue(mutation());
  mockUseDeleteAccount.mockReturnValue(mutation());
  mockUseUserReviews.mockReturnValue(infiniteState([]));
});

const {
  mockUseProfile,
  mockUseProfileUpdate,
  mockUseDeleteAccount,
  mockUseUserReviews,
  mockUseNotifSettings,
} = vi.hoisted(() => ({
  mockUseProfile: vi.fn(),
  mockUseProfileUpdate: vi.fn(),
  mockUseDeleteAccount: vi.fn(),
  mockUseUserReviews: vi.fn(),
  mockUseNotifSettings: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
  useProfileUpdateMutation: mockUseProfileUpdate,
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
  it("шапка с рейтингом и статистикой", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Александр");
    expect(html).toContain("4.9");
    // Значок «Telegram верифицирован» и счётчик отзывов в бейдже убраны
    // осознанно (UI-правка 2026-09-30): бейдж показывает только оценку.
    expect(html).not.toContain("Telegram верифицирован");
    expect(html).not.toContain("4.9 (12)");
    expect(html).toContain("Поездок");
    expect(html).toContain("42");
    expect(html).toContain("Редактировать профиль");
  });

  it("секции настроек: авто, уведомления, поддержка, опасная зона", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Настройки и авто");
    expect(html).toContain("Мои поездки");
    expect(html).toContain("История поездок");
    expect(html).toContain("Автомобиль");
    expect(html).toContain("Octavia");
    expect(html).toContain("Служба поддержки");
    expect(html).toContain("Жалобы");
    // Кнопки «Выйти» нет — только удаление (как Delete My Account официалки).
    expect(html).not.toContain("Выйти");
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

  it("ошибка удаления — текст ошибки как есть, без ветки 409", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    mockUseDeleteAccount.mockReturnValue(
      mutation({
        error: new ApiError("Server boom", "INTERNAL", 500),
      }),
    );
    const html = render(<ProfilePage />);
    expect(html).toContain("Server boom");
    expect(html).not.toContain("Завершите активные поездки");
  });

  it("футер опасной зоны описывает реальный каскад DELETE /me", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    // Свои active-поездки → forced completed (pending отклоняются,
    // confirmed остаются историей), свои брони на чужих active и
    // заявки → cancelled. DELETE /me никогда не отвечает 409.
    expect(html).toContain("Ваши активные поездки завершатся");
    expect(html).toContain("ожидающие заявки отклонятся");
    expect(html).toContain("подтверждённые останутся историей");
    expect(html).toContain("ваши брони на чужих поездках");
    expect(html).toContain("заявки на поездку отменятся");
  });
});

describe("ProfilePage: субтабы как вкладки (APG)", () => {
  it("у каждого role=tab есть id, а у панели — id и aria-labelledby", () => {
    // Реестр B5: замер 2026-10-02 показал 2 role=tab, но 0 role=tabpanel и
    // пустой aria-controls — роли объявляли переключение, а панели под ними
    // для скринридера не существовало.
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('id="profile-subtab-settings"');
    expect(html).toContain('id="profile-subtab-reviews"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('id="profile-subtab-panel-settings"');
    expect(html).toContain('aria-labelledby="profile-subtab-settings"');
  });

  it("aria-controls стоит только на выбранном табе — ссылаться не на что", () => {
    // Панели рендерятся условно, у невыбранного таба панели нет. Проверено в
    // браузере: на невыбранном табе document.getElementById(aria-controls)
    // давал null, то есть ссылка вела в пустоту.
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);

    // Выбран «Настройки и авто» по умолчанию: ровно одна ссылка controls.
    const controls = html.match(/aria-controls="([^"]+)"/g) ?? [];
    expect(controls).toEqual(['aria-controls="profile-subtab-panel-settings"']);
  });

  it("клавиатура: стрелки и Home/End переключают субтаб", () => {
    // Замер 2026-10-03: keydown до кнопки доходил (ArrowRight@BUTTON в логе),
    // но никто его не обрабатывал — табы не переключались с клавиатуры.
    // Рендера недостаточно, поэтому проверяем обработчик в исходнике.
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "ProfilePage.tsx"),
      "utf8",
    );
    // Комментарии чистим: перечень клавиш есть и в комментарии над обработчиком,
    // и без чистки тест проходил бы, даже если бы код их не слушал. Это ровно
    // тот молчаливый тест, который уже ловил в switchRow.test.ts.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(src, `нет обработки ${key}`).toContain(`"${key}"`);
    }
    expect(src).toContain("onKeyDown={onSubtabKeyDown}");
  });
});
