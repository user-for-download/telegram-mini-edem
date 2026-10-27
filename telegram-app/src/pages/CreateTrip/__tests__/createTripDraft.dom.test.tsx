// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { User } from "@edem/contracts";
import { CreateTripForm } from "../CreateTripPage";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft, writeSessionDraft } from "@/helpers/sessionDrafts";

const { mutation, closing, onCreated, onCancel } = vi.hoisted(() => ({
  mutation: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  closing: vi.fn(),
  onCreated: vi.fn(),
  onCancel: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", () => ({ useCreateTripMutation: () => mutation }));
vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: () => ({
    data: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Вологда" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Тула" },
    ],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/queries/vehicle", () => ({
  useVehicleQuery: () => ({ vehicle: { model: "Test car" }, isLoading: false, isFetching: false }),
}));
vi.mock("@/components/Profile/VehicleModal", () => ({ VehicleModal: () => null }));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/hooks/useClosingConfirmation", () => ({ useClosingConfirmation: closing }));
vi.mock("@/utils/haptics", () => ({ haptic: { light: vi.fn(), selection: vi.fn(), success: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

const user: User = {
  id: "draft-user", name: "Draft tester", avatar: "https://example.com/avatar.svg",
  rating: 5, reviewsCount: 0, tripsCount: 0, isVerified: true,
  notificationsEnabled: true, verifiedAt: null, onboardingVersion: null,
  createdAt: "2026-10-24T00:00:00.000Z",
};
const fields = {
  "Город отправления": "11111111-1111-4111-8111-111111111111",
  "Город назначения": "22222222-2222-4222-8222-222222222222",
  "Адрес отправления": "Вокзал, вход 2",
  "Адрес назначения": "Площадь",
  "Дата и время": "2030-06-01T09:00",
  "В пути, часов": "2",
  "Расстояние, км": "180",
  "Цена, ₽": "750",
  "Места": "3",
  "Комментарий": "  Черновик с пробелами  ",
};

function authenticate(id = user.id) {
  useAuthStore.setState({
    status: "authenticated", user: { ...user, id },
    session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 },
  });
}
function form() {
  return <AppRoot platform="base"><CreateTripForm onCreated={onCreated} onCancel={onCancel} /></AppRoot>;
}
function value(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}
function change(label: string, next: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: next } });
}
function fill() {
  for (const [label, next] of Object.entries(fields)) change(label, next);
  fireEvent.click(screen.getByRole("button", { name: "Тихая поездка" }));
  fireEvent.click(screen.getByRole("switch", { name: "Завершать поездку сразу" }));
  fireEvent.click(screen.getByRole("switch", { name: "Предлагать поездку подходящим попутчикам" }));
}
function expectFilled() {
  for (const [label, expected] of Object.entries(fields)) expect(value(label), label).toBe(expected);
  expect(screen.getByRole("button", { name: "Тихая поездка" }).getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByRole("switch", { name: "Завершать поездку сразу" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("switch", { name: "Предлагать поездку подходящим попутчикам" }) as HTMLInputElement).checked).toBe(false);
  expect(closing).toHaveBeenLastCalledWith(true);
}

const originalScroll = Element.prototype.scrollIntoView;
beforeEach(() => {
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate();
  vi.clearAllMocks();
  mutation.error = null;
  mutation.mutate.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ status: "idle", user: null, session: null });
  Element.prototype.scrollIntoView = originalScroll;
  vi.restoreAllMocks();
});

describe("trip creation: session drafts", () => {
  it("retains every field, tag and option after actual unmount/navigation away", () => {
    const view = render(form());
    fill();
    view.unmount();
    render(form());
    expectFilled();
  });

  it("required-city validation preserves entered input across unmount", () => {
    const view = render(form());
    change("Комментарий", "Не терять");
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(mutation.mutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Город отправления").getAttribute("aria-invalid")).toBe("true");
    view.unmount();
    render(form());
    expect(value("Комментарий")).toBe("Не терять");
  });

  it("failed mutation does not clear the draft", () => {
    const view = render(form());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    mutation.error = new Error("network failure");
    view.rerender(form());
    view.unmount();
    render(form());
    expectFilled();
  });

  it.each(["success", "cancel"] as const)("%s clears only this form draft and cannot resurrect it on unmount", (outcome) => {
    const scope = getSessionDraftScope(user.id);
    writeSessionDraft(scope, "trip:edit:other", { comment: "other entity" });
    const view = render(form());
    fill();
    if (outcome === "success") {
      fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
      const callbacks = mutation.mutate.mock.calls[0]?.[1] as {
        onSuccess: (trip: { id: string; fromCity: string; toCity: string }) => void;
      };
      act(() => callbacks.onSuccess({ id: "created-trip", fromCity: "Вологда", toCity: "Тула" }));
      expect(onCreated).toHaveBeenCalledWith("created-trip");
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(value("Комментарий")).toBe("");
      expect(closing).toHaveBeenLastCalledWith(false);
    }
    expect(readSessionDraft(scope, "trip:create")).toBeUndefined();
    expect(readSessionDraft(scope, "trip:edit:other")?.value).toEqual({ comment: "other entity" });
    view.unmount();
    render(form());
    expect(value("Город отправления")).toBe("");
    expect(value("Комментарий")).toBe("");
    expect(value("Цена, ₽")).toBe("500");
  });

  it("logout and identity changes reset mounted/restored drafts without browser storage", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const view = render(form());
    fill();
    act(() => authenticate("other-user"));
    expect(value("Комментарий")).toBe("");
    act(() => authenticate());
    expect(value("Комментарий")).toBe("");
    fill();
    await act(async () => useAuthStore.getState().clearSession("draft test"));
    expect(value("Город отправления")).toBe("");
    act(() => authenticate());
    view.unmount();
    render(form());
    expect(value("Комментарий")).toBe("");
    expect(storageWrite).not.toHaveBeenCalled();
  });
});
