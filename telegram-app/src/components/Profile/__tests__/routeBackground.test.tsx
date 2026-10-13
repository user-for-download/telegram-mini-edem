// @vitest-environment jsdom
// Фон у трёх шторок поверх «Профиля» (/settings, /profile/edit, /vehicle)
// должен быть ОДИН: профиль открытым, затемнённый китовым Modal.
//
// Что было: /settings рендерил <ProfilePage /> открытым, а /profile/edit и
// /vehicle — в <div aria-hidden hidden>. Разнобой давал два разных исхода:
// с одной стороны `hidden` выкидывал фон из дерева доступности и оставлял
// под шторкой пустоту вместо контекста, с другой — «лишний» видимый фон
// на /settings, которого на соседних роутах нет.
//
// DOM, а не SSR: рендер-тест ловит саму разметку фона, а SSR здесь не
// нужен — проверяется структура дерева вокруг ProfilePage. Сам ProfilePage
// замокан: тест про обёртку роута, а не про содержимое профиля (оно
// покрыто ProfilePage.test.tsx).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

vi.mock("@/pages/Profile/ProfilePage", () => ({
  ProfilePage: () => <div data-testid="profile-bg">Профиль</div>,
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({ isLoading: false, data: undefined, error: null }),
  useProfileNotificationSettingsMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
  useProfileUpdateMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

// Тела шторок шлют запросы и показывают тосты — тест про обёртку роута,
// поэтому любые мутации заглушаем, а тосты отдаём пустыми.
vi.mock("@/queries/vehicle", () => ({
  useVehicleQuery: () => ({
    data: undefined,
    vehicle: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertVehicleMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
  useRemoveVehicleMutation: () => ({
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

import { SettingsRoute } from "@/components/Profile/SettingsModal";
import { EditProfileRoute } from "@/components/Profile/EditProfileModal";
import { VehicleRoute } from "@/components/Profile/VehicleModal";

const ROUTES = [
  { name: "/settings", path: "/settings", Route: SettingsRoute },
  { name: "/profile/edit", path: "/profile/edit", Route: EditProfileRoute },
  { name: "/vehicle", path: "/vehicle", Route: VehicleRoute },
] as const;

afterEach(cleanup);

describe("фон под шторкой поверх профиля", () => {
  it.each(ROUTES)("$name: профиль отрисован", ({ path, Route }) => {
    render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={[path]}>
          <Route />
        </MemoryRouter>
      </AppRoot>,
    );
    expect(screen.getByTestId("profile-bg")).toBeTruthy();
  });

  it.each(ROUTES)("$name: фон не выключен из отрисовки", ({ path, Route }) => {
    render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={[path]}>
          <Route />
        </MemoryRouter>
      </AppRoot>,
    );
    const background = screen.getByTestId("profile-bg");

    // Проверяем именно `hidden`, а не aria-hidden: пока шторка открыта, кит
    // (Radix Dialog внутри Modal) САМ ставит aria-hidden фону — так и должно
    // быть, модалка действительно модальная, и бороться с этим не надо.
    // А вот `hidden` — это наш былой способ спрятать фон, и он включал
    // display:none плюс выкидывал страницу из дерева доступности.
    expect(background.closest("[hidden]")).toBeNull();
  });

  it.each(ROUTES)("$name: фон отрисован, а не пустота", ({ path, Route }) => {
    render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={[path]}>
          <Route />
        </MemoryRouter>
      </AppRoot>,
    );
    // Регрессия «под шторкой чёрный прямоугольник»: фон обязан быть в DOM
    // и нести содержимое, а не висеть пустым контейнером.
    const background = screen.getByTestId("profile-bg");
    expect(background.textContent).toBe("Профиль");
  });
});
