// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { useAuthStore } from "@/store/useAuthStore";

const { state, blockMutate, unblockMutate, toastShow } = vi.hoisted(() => ({
  state: { blockedByMe: false },
  blockMutate: vi.fn(),
  unblockMutate: vi.fn(),
  toastShow: vi.fn(),
}));

vi.mock("@/queries/profile", () => ({
  useUserQuery: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/queries/useBlocksQuery", () => ({
  useBlockStatusQuery: () => ({
    data: { blockedByMe: state.blockedByMe },
    error: null,
    refetch: vi.fn(),
  }),
  useBlockUserMutation: () => ({
    mutate: blockMutate,
    reset: vi.fn(),
    error: null,
    isPending: false,
  }),
  useUnblockUserMutation: () => ({
    mutate: unblockMutate,
    reset: vi.fn(),
    error: null,
    isPending: false,
  }),
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: toastShow }),
}));

import {
  UserProfileProvider,
  useOpenUserProfile,
} from "@/components/Profile/UserProfileProvider";

function Probe() {
  const open = useOpenUserProfile();
  return (
    <button
      type="button"
      onClick={() =>
        open({
          id: "u-driver",
          title: "Водитель",
          initial: {
            name: "Плохой водитель",
            avatar: "https://t.me/i/userpic/320/test.svg",
            rating: 3,
            reviewsCount: 2,
            tripsCount: 10,
          },
        })
      }
    >
      Открыть профиль
    </button>
  );
}

function renderProfile() {
  render(
    <AppRoot platform="base">
      <UserProfileProvider>
        <Probe />
      </UserProfileProvider>
    </AppRoot>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Открыть профиль" }));
}

afterEach(() => {
  cleanup();
  state.blockedByMe = false;
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, session: null });
});

describe("UserProfileSheet: чёрный список", () => {
  it("собственному профилю не предлагает блокировку", () => {
    useAuthStore.setState({ user: { id: "u-driver" } as never });
    renderProfile();
    expect(screen.queryByRole("button", { name: "Добавить в чёрный список" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Убрать из чёрного списка" })).toBeNull();
  });
  it("требует подтверждение и передаёт id профиля", () => {
    blockMutate.mockImplementation(
      (_id: string, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    renderProfile();
    fireEvent.click(
      screen.getByRole("button", { name: "Добавить в чёрный список" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Заблокировать пользователя" }),
    );
    expect(blockMutate).toHaveBeenCalledWith(
      "u-driver",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(toastShow).toHaveBeenCalledWith({
      text: "Пользователь добавлен в чёрный список",
    });
  });

  it("для собственной записи показывает обратимое действие", () => {
    state.blockedByMe = true;
    renderProfile();
    fireEvent.click(
      screen.getByRole("button", { name: "Убрать из чёрного списка" }),
    );
    expect(unblockMutate).toHaveBeenCalledWith(
      "u-driver",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
