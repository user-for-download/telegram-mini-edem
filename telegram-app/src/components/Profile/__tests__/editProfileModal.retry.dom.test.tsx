// @vitest-environment jsdom
// Регресс F4: упавшая загрузка профиля в шторке правки обязана давать
// терминальный экран QueryState с «Повторить», который действительно
// зовёт refetch, — а не Notice-тупик, из которого можно выйти только
// закрытием шторки (MEMORY.md §18: сетевая ошибка — не ошибка валидации).
//
// Проверяем поведение, а не разметку: подменён реальный хук запроса на
// минимальный внешний стор, поэтому «повтор» действительно приводит к
// приходу данных и ре-рендеру формы, как это делает react-query.
// Простая проверка «нарисовалось слово Повторить» такой случай пропустила
// бы: кнопка без onRetry выглядит ровно так же.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: {
    selectionChanged: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
  },
  // useClosingConfirmation работает на общем closingBehavior клиента.
  closingBehavior: {
    enableConfirmation: { ifAvailable: vi.fn() },
    disableConfirmation: { ifAvailable: vi.fn() },
  },
}));

// Профиль-стор запроса: снапшот меняется — подписчики перерисовываются,
// как это делает useQuery на успешном refetch.
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const profile = {
    id: "u-1",
    name: "Пётр",
    about: "Про меня",
    phone: "+7 900 123-45-67",
  };
  return {
    profile,
    snapshot: {
      data: undefined as typeof profile | undefined,
      error: new Error("Сеть недоступна") as unknown,
      isLoading: false,
    },
    refetch: vi.fn(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit() {
      listeners.forEach((listener) => listener());
    },
  };
});

// refetch отвечает данными: клик по «Повторить» обязан перечитать профиль.
store.refetch.mockImplementation(() => {
  store.snapshot = { data: store.profile, error: null, isLoading: false };
  store.emit();
  return Promise.resolve({ data: store.profile });
});

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({
    ...useSyncExternalStore(store.subscribe, () => store.snapshot),
    refetch: store.refetch,
  }),
  useProfileUpdateMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

import { EditProfileBody } from "@/components/Profile/EditProfileModal";
import { useProfileQuery } from "@/queries/profile";

// Ровно та же композиция, что в EditProfileModal, но без шторки (в jsdom
// vaul-drawer не нужен): key по id пользователя перемонтирует тело на
// приходе данных — именно так значения профиля попадают в поля после
// повтора, а не остаются пустыми.
function EditProfileSheetBody() {
  const profile = useProfileQuery();
  return (
    <EditProfileBody key={profile.data?.id ?? "loading"} onDone={() => {}} />
  );
}

function renderBody() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AppRoot platform="base">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/profile/edit"]}>
          <EditProfileSheetBody />
        </MemoryRouter>
      </QueryClientProvider>
    </AppRoot>,
  );
}

beforeEach(() => {
  store.refetch.mockClear();
  store.snapshot = {
    data: undefined,
    error: new Error("Сеть недоступна"),
    isLoading: false,
  };
});

afterEach(() => {
  cleanup();
});

describe("EditProfileBody: падение загрузки профиля", () => {
  it("ошибка — терминальный экран, а не форма с ошибкой валидации", () => {
    renderBody();

    expect(screen.getByText("Не удалось загрузить данные")).toBeTruthy();
    // Формы на экране нет: сетевая ошибка не превращается в «заполните
    // форму» — пользователю не показывают поля, которые он не сможет
    // сохранить.
    expect(screen.queryByLabelText("Имя")).toBeNull();
    expect(screen.queryByText("Сохранить изменения")).toBeNull();
  });

  it("«Повторить» зовёт refetch, и на успехе форма появляется без закрытия шторки", () => {
    renderBody();

    const retry = screen.getByRole("button", { name: "Повторить" });
    expect(store.refetch).not.toHaveBeenCalled();

    fireEvent.click(retry);

    expect(store.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Имя")).toBeTruthy();
    expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe(
      "Пётр",
    );
    expect(screen.getByText("Сохранить изменения")).toBeTruthy();
    // Экран ошибки ушёл вместе с формой — двух состояний сразу не рисуем.
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });
});
