// SSR-тесты тела модалки редактирования профиля: форма поверх данных,
// валидация, loading/error, closing-confirmation не мешает рендеру.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";

vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
  },
}));

const profileState = vi.hoisted(() => ({
  current: "ok" as "ok" | "loading" | "error",
}));

vi.mock("@/store/useAuthStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/useAuthStore")>();
  // SSR uses Zustand's initial snapshot; this fixture deliberately reads its owner.
  return {
    ...actual,
    useAuthStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useAuthStore.getState>) => T) => selector(actual.useAuthStore.getState()),
      actual.useAuthStore,
    ),
  };
});

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => {
    if (profileState.current === "loading") return { isLoading: true };
    if (profileState.current === "error") {
      return {
        isLoading: false,
        data: undefined,
        error: new Error("boom"),
        refetch: vi.fn(),
      };
    }
    return {
      isLoading: false,
      data: { id: "profile-owner", name: "Пётр", about: "Про меня" },
      error: null,
    };
  },
  useProfileUpdateMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/pages/Profile/profileValidation", () => ({
  normalizeProfileForm: (name: string, about: string) => ({ name, about }),
  validateProfileForm: () => null,
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

import { EditProfileBody } from "@/components/Profile/EditProfileModal";
import { useAuthStore } from "@/store/useAuthStore";

beforeEach(() => {
  useAuthStore.setState({
    status: "authenticated",
    user: { id: "profile-owner", name: "Пётр", avatar: "", rating: 5, reviewsCount: 0, tripsCount: 0 },
    session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 },
  });
});
afterEach(() => {
  useAuthStore.setState({ status: "idle", user: null, session: null });
  vi.restoreAllMocks();
});

function render(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <AppRoot platform="base">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/profile/edit"]}>
          <EditProfileBody onDone={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
}

describe("EditProfileBody", () => {
  it("форма поверх данных профиля", () => {
    profileState.current = "ok";
    const html = render();
    expect(html).toContain("Пётр");
    expect(html).toContain("Про меня");
    expect(html).toContain("Сохранить изменения");
    expect(html).toContain("Отмена");
  });

  it("loading и ошибка", () => {
    profileState.current = "loading";
    expect(render()).toContain("Загрузка профиля");
    // Ошибка загрузки — терминальный экран QueryState с «Повторить»,
    // а не Notice-тупик; сам повтор проверен по DOM в
    // editProfileModal.retry.dom.test.tsx.
    profileState.current = "error";
    const errorHtml = render();
    expect(errorHtml).toContain("Не удалось загрузить данные");
    expect(errorHtml).toContain("Повторить");
    expect(errorHtml).not.toContain("Сохранить изменения");
    profileState.current = "ok";
  });
});
