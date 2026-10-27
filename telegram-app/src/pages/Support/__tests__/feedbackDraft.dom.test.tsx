// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { User } from "@/types";

const mocks = vi.hoisted(() => ({ create: vi.fn(), mutate: vi.fn() }));
vi.mock("@/queries/useSupportQuery", () => ({ useCreateFeedbackMutation: mocks.create }));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/utils/haptics", () => ({ haptic: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

import { FeedbackForm } from "@/pages/Support/FeedbackForm";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";
import { ApiError } from "@/api/client";

const USER: User = {
  id: "support-owner", name: "Автор", avatar: "https://example.com/avatar.svg",
  rating: 5, reviewsCount: 0, tripsCount: 0,
};
function authenticate(id = USER.id) {
  useAuthStore.setState({
    status: "authenticated", user: { ...USER, id },
    session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 },
  });
}
function renderForm(onSubmitted = vi.fn()) {
  return render(<AppRoot platform="base"><FeedbackForm onSubmitted={onSubmitted} /></AppRoot>);
}
function value(label: string) {
  return screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>(label).value;
}
function fill() {
  fireEvent.change(screen.getByLabelText("Тема"), { target: { value: "Уведомления" } });
  fireEvent.change(screen.getByLabelText("Сообщение"), { target: { value: "Не приходят уведомления" } });
}
beforeEach(() => {
  mocks.mutate.mockReset();
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate();
  mocks.create.mockReturnValue({ mutate: mocks.mutate, isPending: false, error: null });
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

describe("support session draft", () => {
  it("retains subject/text after actual unmount/remount without adding a Cancel feature", () => {
    const view = renderForm();
    fill();
    view.unmount();
    renderForm();
    expect(value("Тема")).toBe("Уведомления");
    expect(value("Сообщение")).toBe("Не приходят уведомления");
    expect(screen.queryByRole("button", { name: "Отмена" })).toBeNull();
  });

  it.each([new Error("Network"), new ApiError("Too many", "RATE_LIMITED", 429)])(
    "failed request retains fields on reopen: %s", (error) => {
      let settled: (() => void) | undefined;
      mocks.mutate.mockImplementation((_data: unknown, callbacks: { onSettled: () => void }) => {
        settled = callbacks.onSettled;
      });
      const view = renderForm();
      fill();
      fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
      act(() => { settled!(); });
      mocks.create.mockReturnValue({ mutate: mocks.mutate, isPending: false, error });
      view.unmount();
      renderForm();
      expect(value("Тема")).toBe("Уведомления");
      expect(value("Сообщение")).toBe("Не приходят уведомления");
      fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
      expect(mocks.mutate).toHaveBeenCalledTimes(2);
    },
  );

  it("success clears synchronously before closing and does not cache reset input", () => {
    const done = vi.fn(() => {
      expect(readSessionDraft(getSessionDraftScope(USER.id), "support:new")).toBeUndefined();
    });
    mocks.mutate.mockImplementation((_data: unknown, callbacks: { onSuccess: () => void; onSettled: () => void }) => {
      callbacks.onSuccess();
      callbacks.onSettled();
    });
    const view = renderForm(done);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(done).toHaveBeenCalledTimes(1);
    view.unmount();
    renderForm();
    expect(value("Тема")).toBe("");
    expect(value("Сообщение")).toBe("");
  });

  it("logout clears fields for another user and for re-login as the same user", () => {
    const view = renderForm();
    fill();
    view.unmount();
    useAuthStore.setState({ status: "unauthenticated", user: null, session: null });
    authenticate("another-user");
    const reopened = renderForm();
    expect(value("Тема")).toBe("");
    expect(value("Сообщение")).toBe("");
    reopened.unmount();
    authenticate();
    renderForm();
    expect(value("Сообщение")).toBe("");
  });
});
