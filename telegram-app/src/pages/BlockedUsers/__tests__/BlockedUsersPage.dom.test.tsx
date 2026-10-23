// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { unblockMutate, toastShow } = vi.hoisted(() => ({
  unblockMutate: vi.fn(),
  toastShow: vi.fn(),
}));

vi.mock("@/queries/useBlocksQuery", () => ({
  useInfiniteBlockedUsersQuery: () => ({
    data: {
      pages: [
        {
          items: [
            {
              user: {
                id: "u-blocked",
                name: "Заблокированный водитель",
                avatar: "https://t.me/i/userpic/320/test.svg",
                rating: 4,
                reviewsCount: 2,
                tripsCount: 5,
              },
              blockedAt: "2026-10-23T18:00:00.000Z",
            },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
            hasMore: false,
          },
        },
      ],
    },
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useUnblockUserMutation: () => ({
    mutate: unblockMutate,
    isPending: false,
    variables: undefined,
    error: null,
  }),
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: toastShow }),
}));

import { BlockedUsersPage } from "@/pages/BlockedUsers/BlockedUsersPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BlockedUsersPage", () => {
  it("показывает список и отдельную доступную кнопку разблокировки", () => {
    render(
      <AppRoot platform="base">
        <BlockedUsersPage />
      </AppRoot>,
    );
    expect(
      screen.getByRole("heading", { name: "Чёрный список" }),
    ).toBeTruthy();
    expect(screen.getByText("Заблокированный водитель")).toBeTruthy();
    const action = screen.getByRole("button", { name: "Разблокировать" });
    expect(action.parentElement?.closest("button")).toBeNull();

    fireEvent.click(action);
    expect(unblockMutate).toHaveBeenCalledWith(
      "u-blocked",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
