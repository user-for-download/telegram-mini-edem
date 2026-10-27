// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { unblockMutate, toastShow, unblockState } = vi.hoisted(() => ({
  unblockMutate: vi.fn(),
  toastShow: vi.fn(),
  unblockState: { isPending: false as boolean, variables: undefined as string | undefined },
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
    isPending: unblockState.isPending,
    variables: unblockState.variables,
    error: null,
  }),
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: toastShow }),
}));

import { BlockedUsersPage } from "@/pages/BlockedUsers/BlockedUsersPage";
import { ICON_TARGET } from "@/ui/classes";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  unblockState.isPending = false;
  unblockState.variables = undefined;
});

describe("BlockedUsersPage", () => {
  it("показывает список и отдельную иконку разблокировки 44×44", () => {
    render(
      <AppRoot platform="base">
        <BlockedUsersPage />
      </AppRoot>,
    );
    expect(
      screen.getByRole("heading", { name: "Чёрный список" }),
    ).toBeTruthy();
    expect(screen.getByText("Заблокированный водитель")).toBeTruthy();
    const action = screen.getByRole("button", {
      name: "Разблокировать Заблокированный водитель",
    });
    // Иконка без видимого текста: глагол остаётся в доступном имени и title.
    expect(action.textContent).toBe("");
    expect(action.getAttribute("title")).toBe("Разблокировать");
    expect(action.querySelector("svg")).toBeTruthy();
    expect(ICON_TARGET).toBeTruthy();
    expect(action.classList.contains(ICON_TARGET ?? "")).toBe(true);
    expect(action.getAttribute("data-tap-target")).toBeNull();
    // Имя и дата — в content Cell, действие — в отдельном after-слоте.
    expect(action.textContent).not.toContain("Заблокированный водитель");
    expect(screen.getByText("Добавлен 23.10.2026")).toBeTruthy();

    fireEvent.click(action);
    expect(unblockMutate).toHaveBeenCalledWith(
      "u-blocked",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("во время разблокировки показывает спиннер и блокирует повторный тап", () => {
    unblockState.isPending = true;
    unblockState.variables = "u-blocked";
    render(
      <AppRoot platform="base">
        <BlockedUsersPage />
      </AppRoot>,
    );
    const action = screen.getByRole("button", {
      name: "Разблокировать Заблокированный водитель",
    });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute("aria-busy")).toBe("true");
    expect(action.querySelector(".lucide-lock-open")).toBeNull();
  });

  it("иконка не переносит длинное имя в тесную колонку действия", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../BlockedUsersPage.tsx"),
      "utf8",
    );
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../BlockedUsersPage.module.css"),
      "utf8",
    );
    expect(source).toMatch(/<Cell[\s\S]*?\bmultiline\b/);
    expect(source).toMatch(/after=\{[\s\S]*?<IconButton[\s\S]*?Разблокировать/);
    expect(css).toMatch(/\.name\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
