// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { User } from "@/types";

const mocks = vi.hoisted(() => ({ targets: vi.fn(), mutate: vi.fn(), dirty: vi.fn() }));
vi.mock("@/queries/useReportQuery", () => ({
  useReportTargetsQuery: mocks.targets,
  useCreateReportMutation: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
}));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/hooks/useClosingConfirmation", () => ({ useClosingConfirmation: mocks.dirty }));
vi.mock("@/utils/haptics", () => ({ haptic: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

import { ComplaintForm } from "@/pages/Reports/ComplaintForm";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";
import { ApiError } from "@/api/client";

const USER: User = {
  id: "complaint-owner", name: "Автор", avatar: "https://example.com/avatar.svg",
  rating: 5, reviewsCount: 0, tripsCount: 0,
};
const TARGETS = [
  { targetType: "trip", id: "same-id", fromCity: "Вологда", toCity: "Череповец", departureAt: "2026-10-23T10:00:00.000Z" },
  { targetType: "user", id: "same-id", name: "Водитель" },
];
interface Callbacks {
  onSuccess: () => void;
  onError: (error: Error) => void;
  onSettled: () => void;
}
function authenticate(id = USER.id) {
  useAuthStore.setState({
    status: "authenticated", user: { ...USER, id },
    session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 },
  });
}
function query(data = TARGETS) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}
function form(onSubmitted = vi.fn()) {
  return <AppRoot platform="base"><ComplaintForm reports={[]} onSubmitted={onSubmitted} /></AppRoot>;
}
function value(label: string) {
  return screen.getByLabelText<HTMLSelectElement | HTMLTextAreaElement>(label).value;
}
function select(targetKey = "trip:same-id") {
  fireEvent.change(screen.getByLabelText("На что жалуетесь"), { target: { value: targetKey } });
}
function fill() {
  select();
  fireEvent.change(screen.getByLabelText("Причина"), { target: { value: "fraud" } });
  fireEvent.change(screen.getByLabelText("Описание"), { target: { value: "Описание проблемы" } });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutate.mockReset();
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate();
  mocks.targets.mockReturnValue(query());
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

describe("complaint session draft", () => {
  it("actual unmount/reopen preserves target, category, description and dirty guard", () => {
    const view = render(form());
    fill();
    expect(mocks.dirty).toHaveBeenLastCalledWith(true);
    view.unmount();
    render(form());
    expect(value("На что жалуетесь")).toBe("trip:same-id");
    expect(value("Причина")).toBe("fraud");
    expect(value("Описание")).toBe("Описание проблемы");
    expect(screen.queryByRole("button", { name: "Отмена" })).toBeNull();
  });

  it("stale target has accessible validation, cannot submit, and another type with same id stays unambiguous", () => {
    const view = render(form());
    fill();
    view.unmount();
    mocks.targets.mockReturnValue(query([TARGETS[1]!]));
    render(form());
    const target = screen.getByLabelText("На что жалуетесь");
    expect(value("На что жалуетесь")).toBe("");
    expect(target.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(target.getAttribute("aria-describedby")!)?.textContent).toContain("больше недоступен");
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Отправить жалобу" });
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mocks.mutate).not.toHaveBeenCalled();
    select("user:same-id");
    fireEvent.click(submit);
    expect(mocks.mutate).toHaveBeenCalledWith(
      { targetType: "user", targetId: "same-id", category: "fraud", description: "Описание проблемы", onCommitted: expect.any(Function) },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it.each([
    new Error("Network"), new ApiError("Conflict", "CONFLICT", 409), new ApiError("Too many", "RATE_LIMITED", 429),
  ])("failed submission preserves the draft on reopen: %s", (error) => {
    let callbacks: Callbacks | undefined;
    mocks.mutate.mockImplementation((_data: unknown, options: Callbacks) => { callbacks = options; });
    const view = render(form());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Отправить жалобу" }));
    act(() => { callbacks!.onError(error); callbacks!.onSettled(); });
    view.unmount();
    render(form());
    expect(value("На что жалуетесь")).toBe("trip:same-id");
    expect(value("Причина")).toBe("fraud");
    expect(value("Описание")).toBe("Описание проблемы");
    fireEvent.click(screen.getByRole("button", { name: "Отправить жалобу" }));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it("successful submission clears before onSubmitted and reset values are not re-cached", () => {
    const done = vi.fn(() => {
      expect(readSessionDraft(getSessionDraftScope(USER.id), "complaint:new")).toBeUndefined();
    });
    mocks.mutate.mockImplementation((_data: unknown, options: Callbacks) => {
      options.onSuccess(); options.onSettled();
    });
    const view = render(form(done));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Отправить жалобу" }));
    expect(done).toHaveBeenCalledTimes(1);
    view.unmount();
    render(form());
    expect(value("На что жалуетесь")).toBe("");
    expect(value("Причина")).toBe("safety");
    expect(value("Описание")).toBe("");
  });

  it("target lookup errors disable submission even with previously cached allowed targets", () => {
    const view = render(form());
    fill();
    mocks.targets.mockReturnValue({ ...query(), isError: true, error: new Error("Network") });
    view.rerender(form());
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить жалобу" }).disabled).toBe(true);
    expect(value("Описание")).toBe("Описание проблемы");
  });

  it("logout prevents the next user receiving this complaint", () => {
    const view = render(form());
    fill();
    view.unmount();
    useAuthStore.setState({ status: "unauthenticated", user: null, session: null });
    authenticate("another-user");
    render(form());
    expect(value("На что жалуетесь")).toBe("");
    expect(value("Описание")).toBe("");
  });
});
