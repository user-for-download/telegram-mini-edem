// SSR-тесты тела модалки редактирования профиля: форма поверх данных,
// валидация, loading/error, closing-confirmation не мешает рендеру.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";

vi.mock("@telegram-apps/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
  },
}));

const profileState = vi.hoisted(() => ({ current: "ok" as "ok" | "loading" | "error" }));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => {
    if (profileState.current === "loading") return { isLoading: true };
    if (profileState.current === "error") {
      return { isLoading: false, data: undefined, error: new Error("boom") };
    }
    return {
      isLoading: false,
      data: { name: "Пётр", about: "Про меня" },
      error: null,
    };
  },
  useProfileUpdateMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock("@/pages/profileValidation", () => ({
  normalizeProfileForm: (name: string, about: string) => ({ name, about }),
  validateProfileForm: () => null,
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

import { EditProfileBody } from "@/components/Profile/EditProfileModal";

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    profileState.current = "error";
    expect(render()).toContain("boom");
    profileState.current = "ok";
  });
});
