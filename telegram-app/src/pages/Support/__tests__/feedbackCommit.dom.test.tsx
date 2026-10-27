// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ create: vi.fn(), toast: vi.fn() }));
vi.mock("@/api/support", () => ({ supportApi: { create: mocks.create } }));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: mocks.toast }) }));
vi.mock("@/utils/haptics", () => ({ haptic: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

import { FeedbackForm } from "@/pages/Support/FeedbackForm";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";

const USER = { id: "feedback-commit-owner", name: "Автор", avatar: "", rating: 5, reviewsCount: 0, tripsCount: 0 };
let client: QueryClient;
let resolve: (value: unknown) => void;
let reject: (error: Error) => void;
function form(done = vi.fn()) {
  return render(<QueryClientProvider client={client}><AppRoot platform="base"><FeedbackForm onSubmitted={done} /></AppRoot></QueryClientProvider>);
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function value(label: string) {
  return screen.getByLabelText<HTMLInputElement>(label).value;
}
async function submit() {
  const done = vi.fn();
  const editor = form(done);
  change("Тема", "Уведомления");
  change("Сообщение", "Не приходят уведомления");
  fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create).toHaveBeenCalledWith({ subject: "Уведомления", text: "Не приходят уведомления" });
  return { editor, done };
}
async function succeed() {
  await act(async () => resolve({ id: "feedback-created" }));
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe("success"));
}
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  useAuthStore.setState({ status: "idle", user: null, session: null });
  useAuthStore.setState({ status: "authenticated", user: USER, session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 } });
  mocks.create.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
});
afterEach(() => {
  cleanup();
  client.clear();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

describe("FeedbackForm with real TanStack mutation lifecycle", () => {
  it("success after unmount clears the draft without running mounted-only UI callbacks", async () => {
    const { editor, done } = await submit();
    editor.unmount();
    await succeed();
    expect(readSessionDraft(getSessionDraftScope(USER.id), "support:new")).toBeUndefined();
    expect(done).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    form();
    expect(value("Тема")).toBe("");
    expect(value("Сообщение")).toBe("");
  });

  it.each([false, true])("reopened pending form observes success without erasing newer input=%s", async (edit) => {
    const { editor, done } = await submit();
    editor.unmount();
    const reopened = form();
    expect(value("Сообщение")).toBe("Не приходят уведомления");
    if (edit) change("Сообщение", "Новый текст после открытия");
    await succeed();
    expect(value("Сообщение")).toBe(edit ? "Новый текст после открытия" : "");
    expect(done).not.toHaveBeenCalled();
    reopened.unmount();
    form();
    expect(value("Сообщение")).toBe(edit ? "Новый текст после открытия" : "");
  });

  it("mounted creation form does not reset or close after newer edits", async () => {
    const { done } = await submit();
    change("Сообщение", "Новый текст в открытой форме");
    await succeed();
    expect(value("Сообщение")).toBe("Новый текст в открытой форме");
    expect(done).not.toHaveBeenCalled();
  });

  it("mounted unchanged success clears before closing", async () => {
    const { done } = await submit();
    await succeed();
    expect(done).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(value("Тема")).toBe("");
    expect(value("Сообщение")).toBe("");
    expect(readSessionDraft(getSessionDraftScope(USER.id), "support:new")).toBeUndefined();
  });

  it("failure after unmount retains submitted fields without UI success", async () => {
    const { editor, done } = await submit();
    editor.unmount();
    await act(async () => reject(new Error("Network failure")));
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe("error"));
    expect(done).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    form();
    expect(value("Сообщение")).toBe("Не приходят уведомления");
  });

  it.each([USER.id, "another-feedback-owner"])("late mounted success cannot close or wipe a new login's draft: %s", async (ownerId) => {
    const { done } = await submit();
    act(() => {
      useAuthStore.setState({ status: "unauthenticated", user: null, session: null });
      useAuthStore.setState({ status: "authenticated", user: { ...USER, id: ownerId }, session: { accessToken: "later-access", refreshToken: "later-refresh", expiresAt: 0 } });
    });
    change("Тема", "Новая сессия");
    change("Сообщение", "Новый черновик");
    await succeed();
    expect(value("Сообщение")).toBe("Новый черновик");
    expect(readSessionDraft(getSessionDraftScope(ownerId), "support:new")?.value).toEqual({ subject: "Новая сессия", text: "Новый черновик" });
    expect(done).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
