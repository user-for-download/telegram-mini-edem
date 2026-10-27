// Рендер-тесты профиля: шапка с рейтингом/статистикой, секции настроек,
// терминальные экраны бана/удаления. Отзывы уехали в отдельную страницу
// (pages/Reviews/__tests__/ReviewsPage.test.tsx), формы валидации покрыты
// в profileForm.test.ts — здесь не дублируются.
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
  mockUseNotifSettings: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: mockUseProfile,
  useProfileUpdateMutation: mockUseProfileUpdate,
  useDeleteAccountMutation: mockUseDeleteAccount,
  useProfileNotificationSettingsMutation: mockUseNotifSettings,
}));

vi.mock("@/queries/useReviewsQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useReviewsQuery")>();
  return {
    ...original,
    useUserReviewsInfiniteQuery: mockUseUserReviews,
  };
});

import {
  ACCOUNT_DELETED_CODE,
  ACCOUNT_DELETED_MESSAGE,
  ApiError,
} from "@/api/client";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import { ToastProvider } from "@/components/Toast/ToastProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MenuRow } from "@/ui/MenuRow";
import uiStyles from "@/ui/ui.module.css";

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

function infiniteState(
  items: unknown[],
  overrides: Record<string, unknown> = {},
) {
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
  // QueryClient — как AppConfig в проде: страницы под профилем (список
  // обращений) тянут useQueryClient.
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
  it.each(["loading", "error"])("%s остаётся в Page с именем экрана", (state) => {
    mockUseProfile.mockReturnValue(queryState({
      isLoading: state === "loading",
      error: state === "error" ? new Error("Failed") : null,
    }));
    const html = render(<ProfilePage />);
    expect(html).toContain(uiStyles.page);
    expect(html).toContain("Профиль");
  });

  it("ошибка фонового обновления не стирает профиль", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile(), error: new Error("Refetch failed") }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Александр");
    expect(html).toContain("Повторить обновление профиля");
  });
  it("шапка с рейтингом и статистикой", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Александр");
    expect(html).toContain("4.9");
    // Значок «Telegram верифицирован» и счётчик отзывов в бейдже убраны
    // осознанно: бейдж показывает только оценку.
    expect(html).not.toContain("Telegram верифицирован");
    expect(html).not.toContain("4.9 (12)");
    // Плитки статистики убраны: те же три числа стоят строкой метрик в
    // шапке, дубль на одном экране читался как четыре показателя.
    expect(html).toContain("42 поездки");
    expect(html).not.toContain("Поездок");
    expect(html).toContain("Редактировать профиль");
  });

  it("плитки показателей не дублируют строку метрик", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    // Дубль отслеживаем по ярлыкам плиток: в шапке подписи строчные
    // («N поездок», «N отзывов»), у плиток они были отдельными
    // заголовками «Поездок» / «Отзывов». Считать сами числа нельзя —
    // они встречаются и в других секциях экрана.
    expect(html).not.toContain("Поездок");
    expect(html).not.toContain("Отзывов");
    expect(html).toContain("42 поездки");
    expect(html).toContain("12 отзывов");
  });

  // Шапка перестроена в центрированную витрину: аватар 96, имя, телефон,
  // строка метрик и кнопка правки по центру.
  it("шапка-витрина: телефон и метрики в одну строку", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: makeProfile({ phone: "+7 900 123-45-67" }) }),
    );
    const html = render(<ProfilePage />);

    expect(html).toContain("+7 900 123-45-67");
    expect(html).toContain("42 поездки");
    expect(html).toContain("отзывов");
    expect(html).toContain("Редактировать профиль");
  });

  it("без телефона строка не рисуется, шапка не пустая", () => {
    // phone необязателен в контракте — отсутствие = не указан, а не 0.
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);

    expect(html).toContain("Александр");
    expect(html).not.toContain("+7");
  });

  it("число отзывов склоняется, а не пишется «отзывов» на все числа", () => {
    // Рядом стоит пилюля рейтинга, которая при нуле отзывов показывает
    // прочерк. «0 отзывов» рядом с прочерком читается как ошибка подписи.
    for (const [count, word] of [
      [1, "отзыв"],
      [2, "отзыва"],
      [5, "отзывов"],
    ] as const) {
      mockUseProfile.mockReturnValue(
        queryState({ data: makeProfile({ reviewsCount: count }) }),
      );
      const html = render(<ProfilePage />);
      expect(html).toContain(`${count} ${word}`);
    }
  });

  it("секции настроек: авто, уведомления, поддержка, опасная зона", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Мои поездки");
    expect(html).toContain("История поездок");
    // Запросы на попутку — отдельная страница /profile/ride-requests,
    // вторая строка рядом с историей поездок (иконка другая).
    expect(html).toContain("История запросов");
    expect(html).toContain("Мои запросы на попутку");
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

  it("настройка уведомлений одна: строка-переход, а не второй тумблер", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);
    expect(html).toContain("Настройки уведомлений");
    // Подпись — короче 30 знаков: `MenuRow` режет хвост многоточием
    // (реестр #29), а обрезанное «Брони, статусы поездок, отв…» обещало
    // ровно то, чего пользователь уже не прочитает.
    expect(html).toContain("Брони и статусы поездок");
    // Переключателей на странице ровно два — тема и звук: уведомления уехали
    // в шторку /settings, потому что до 2026-10-19 одна и та же серверная
    // настройка показывалась ДВУМЯ контролами (реестр #52).
    expect(html.match(/role="switch"/g) ?? []).toHaveLength(2);
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "ProfilePage.tsx"),
      "utf8",
    );
    expect(raw).not.toContain("useProfileNotificationSettingsMutation");
    expect(raw).toContain('navigate("/settings")');
  });

  it("без авто — CTA добавления", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: makeProfile({ car: null }) }),
    );
    const html = render(<ProfilePage />);
    expect(html).toContain("Добавить автомобиль");
  });

  it("важные пункты меню используют перенос, а не ellipsis", () => {
    mockUseProfile.mockReturnValue(
      queryState({ data: makeProfile({ car: null }) }),
    );
    const html = render(<ProfilePage />);
    const rowClasses = render(
      <MenuRow
        icon={null}
        title="Название"
        subtitle="Подпись"
        multiline
        onClick={() => {}}
      />,
    ).match(/<button[^>]*class="([^"]+)"/)?.[1];
    expect(rowClasses).toBeTruthy();
    const rows = html.match(/<button[^>]*>/g) ?? [];
    for (const title of [
      "История поездок",
      "История запросов",
      "Добавить автомобиль",
      "Настройки уведомлений",
      "Служба поддержки",
      "Чёрный список",
    ]) {
      const row = rows.find((button) => button.includes(`aria-label="${title}.`));
      expect(row, title).toContain(`class="${rowClasses}"`);
    }
  });
});

describe("ProfilePage terminal states", () => {
  it("403 удалённого аккаунта — экран «Профиль удалён»", () => {
    mockUseProfile.mockReturnValue(
      queryState({
        data: undefined,
        isError: true,
        // Новый код: текст переписан, различение обязано остаться верным.
        error: new ApiError("Профиль удалён", ACCOUNT_DELETED_CODE, 403),
      }),
    );
    const html = render(<ProfilePage />);
    expect(html).toContain("Профиль удалён");
  });

  it("старый бэк: FORBIDDEN + текст — тоже «Профиль удалён» (фолбэк)", () => {
    mockUseProfile.mockReturnValue(
      queryState({
        data: undefined,
        isError: true,
        error: new ApiError(ACCOUNT_DELETED_MESSAGE, "FORBIDDEN", 403),
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

describe("ProfilePage: отзывы уехали в отдельную страницу", () => {
  it("пункт меню «Отзывы» есть и несёт счётчик отзывов", () => {
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);

    expect(html).toContain("Отзывы");
    expect(html).toContain("Мои отзывы и обо мне");
  });

  it("пункт ведёт на /reviews (исходник: SSR не рендерит onClick)", () => {
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "ProfilePage.tsx"),
      "utf8",
    );
    expect(raw).toContain('navigate("/reviews")');
  });

  it("субтабов и списка отзывов на странице больше нет", () => {
    // APG-механизм (tablist/tab/tabpanel, стрелки, aria-controls) уехал
    // вместе с вкладками: страница — плоский список секций, а список
    // «Обо мне» живёт только в ReviewsPage.
    mockUseProfile.mockReturnValue(queryState({ data: makeProfile() }));
    const html = render(<ProfilePage />);

    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tabpanel"');
    expect(html).not.toContain('id="profile-subtab-');
  });
});
