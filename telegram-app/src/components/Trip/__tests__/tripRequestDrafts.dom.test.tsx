// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { RideRequest, Trip, User } from "@edem/contracts";
import { EditTripForm } from "../EditTripForm";
import { RideRequestCreateForm } from "../RideRequestCreateForm";
import { RideRequestDetailsBody } from "../RideRequestDetailsModal";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft, writeSessionDraft } from "@/helpers/sessionDrafts";

const { tripUpdate, requestCreate, requestUpdate, checkTrip, closing, done } = vi.hoisted(() => ({
  tripUpdate: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  requestCreate: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  requestUpdate: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  checkTrip: vi.fn(), closing: vi.fn(), done: vi.fn(),
}));
vi.mock("@/queries/useTripsQuery", () => ({ useUpdateTripMutation: () => tripUpdate }));
vi.mock("@/queries/useRideRequestsQuery", () => ({
  useCreateRideRequestMutation: () => requestCreate,
  useUpdateRideRequestMutation: () => requestUpdate,
  useRideRequestStatusMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelRideRequestMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: () => ({
    data: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Вологда" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Тула" },
    ],
    isLoading: false, isError: false,
  }),
}));
vi.mock("../useMatchingTripCheck", () => ({ useMatchingTripCheck: () => checkTrip }));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/hooks/useClosingConfirmation", () => ({ useClosingConfirmation: closing }));
vi.mock("@/utils/haptics", () => ({ haptic: { light: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

const user: User = {
  id: "draft-user", name: "Draft tester", avatar: "https://example.com/avatar.svg",
  rating: 5, reviewsCount: 0, tripsCount: 0, isVerified: true,
  notificationsEnabled: true, verifiedAt: null, onboardingVersion: null,
  createdAt: "2026-10-24T00:00:00.000Z",
};
function authenticate(id = user.id) {
  useAuthStore.setState({
    status: "authenticated", user: { ...user, id },
    session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 },
  });
}
function makeTrip(id = "trip-1"): Trip {
  return {
    id, fromCity: "Вологда", toCity: "Тула", fromAddress: "Вокзал", toAddress: "Площадь",
    date: "2030-06-01", time: "09:00", departureAt: "2030-06-01T06:00:00.000Z",
    durationMinutes: 110, distanceKm: 180, price: 500, seatsTotal: 2, seatsAvailable: 2,
    driver: user, tags: [], comment: "Исходный комментарий", autoComplete: false, matchingEnabled: true,
  };
}
function makeRequest(id = "request-1"): RideRequest {
  return {
    id, fromCity: { id: "c-1", name: "Вологда" }, toCity: { id: "c-2", name: "Тула" },
    earliestAt: "2030-06-01T06:00:00.000Z", latestAt: "2030-06-01T15:00:00.000Z",
    expiresAt: "2030-06-01T15:00:00.000Z", seats: 2, status: "active",
    createdAt: "2026-10-24T00:00:00.000Z", updatedAt: "2026-10-24T00:00:00.000Z",
  };
}
function tripForm(id?: string) {
  return <AppRoot platform="base"><EditTripForm trip={makeTrip(id)} onDone={done} /></AppRoot>;
}
function createForm() {
  return <AppRoot platform="base"><RideRequestCreateForm /></AppRoot>;
}
function editForm(id?: string) {
  return <AppRoot platform="base"><RideRequestDetailsBody request={makeRequest(id)} onClose={done} /></AppRoot>;
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function value(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}
function click(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}
function fill(fields: Record<string, string>) {
  for (const [label, next] of Object.entries(fields)) change(label, next);
}
function expectFields(fields: Record<string, string>) {
  for (const [label, expected] of Object.entries(fields)) expect(value(label), label).toBe(expected);
}
function expectOtherDraft() {
  expect(readSessionDraft(getSessionDraftScope(user.id), "unrelated")?.value).toBe("keep me");
}
interface Callbacks {
  onSuccess?: () => void;
  onError?: () => void;
  onSettled?: () => void;
}

beforeEach(() => {
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate();
  vi.clearAllMocks();
  for (const mutation of [tripUpdate, requestCreate, requestUpdate]) {
    mutation.mutate.mockReset();
    mutation.isPending = false;
    mutation.error = null;
  }
  checkTrip.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ status: "idle", user: null, session: null });
  vi.restoreAllMocks();
});

const tripFields = {
  "Адрес отправления": "  Новый вокзал  ", "Адрес назначения": "Другой вход",
  "Дата и время": "2030-06-02T10:15", "В пути, минут": "125",
  "Расстояние, км": "200", "Цена, ₽": "750", "Места": "3", "Комментарий пассажирам": "",
};
describe("trip edit: session drafts", () => {
  it("retains all fields including empty comment and exact minutes on actual unmount", () => {
    const view = render(tripForm());
    fill(tripFields);
    click("Тихая поездка");
    view.unmount();
    render(tripForm());
    expectFields(tripFields);
    expect(screen.getByRole("button", { name: "Тихая поездка" }).getAttribute("aria-pressed")).toBe("true");
    expect(closing).toHaveBeenLastCalledWith(true);
    click("Сохранить");
    expect(tripUpdate.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "trip-1", data: expect.objectContaining({ comment: "", durationMinutes: 125 }) }),
      expect.any(Object),
    );
  });

  it.each(["success", "cancel"] as const)("%s clears only this entity's draft", (outcome) => {
    writeSessionDraft(getSessionDraftScope(user.id), "unrelated", "keep me");
    const view = render(tripForm());
    fill(tripFields);
    if (outcome === "success") {
      click("Сохранить");
      const callbacks = tripUpdate.mutate.mock.calls[0]?.[1] as Callbacks;
      act(() => callbacks.onSuccess?.());
    } else click("Отмена");
    expect(done).toHaveBeenCalledTimes(1);
    expect(readSessionDraft(getSessionDraftScope(user.id), "trip:edit:trip-1")).toBeUndefined();
    expectOtherDraft();
    view.unmount();
    render(tripForm());
    expect(value("Комментарий пассажирам")).toBe("Исходный комментарий");
    expect(value("В пути, минут")).toBe("110");
  });

  it.each(["validation", "network"] as const)("%s failure retains the draft", (failure) => {
    const view = render(tripForm());
    fill(tripFields);
    if (failure === "validation") change("В пути, минут", "1.5");
    click("Сохранить");
    if (failure === "validation") expect(tripUpdate.mutate).not.toHaveBeenCalled();
    else {
      expect(tripUpdate.mutate).toHaveBeenCalledTimes(1);
      tripUpdate.error = new Error("network failure");
      view.rerender(tripForm());
    }
    view.unmount();
    render(tripForm());
    expect(value("Адрес отправления")).toBe(tripFields["Адрес отправления"]);
    expect(value("В пути, минут")).toBe(failure === "validation" ? "1.5" : "125");
  });

  it("isolates entity keys even when the same component switches without unmount", () => {
    const view = render(tripForm());
    change("Комментарий пассажирам", "Trip one draft");
    view.rerender(tripForm("trip-2"));
    expect(value("Комментарий пассажирам")).toBe("Исходный комментарий");
    change("Комментарий пассажирам", "Trip two draft");
    view.rerender(tripForm());
    expect(value("Комментарий пассажирам")).toBe("Trip one draft");
    view.rerender(tripForm("trip-2"));
    expect(value("Комментарий пассажирам")).toBe("Trip two draft");
  });
});

const createFields = {
  "Откуда": "11111111-1111-4111-8111-111111111111",
  "Куда": "22222222-2222-4222-8222-222222222222",
  "Не раньше": "2030-06-01T09:15", "Не позже": "2030-06-01T19:45", "Места": "3",
};
describe("ride request creation: session drafts", () => {
  it("retains every field on actual unmount/reopen and keeps dirty confirmation", () => {
    const view = render(createForm());
    fill(createFields);
    view.unmount();
    render(createForm());
    expectFields(createFields);
    expect(closing).toHaveBeenLastCalledWith(true);
  });

  it.each(["success", "cancel"] as const)("%s clears its draft without clearing another form", async (outcome) => {
    writeSessionDraft(getSessionDraftScope(user.id), "unrelated", "keep me");
    const view = render(createForm());
    fill(createFields);
    if (outcome === "success") {
      click("Опубликовать запрос");
      await waitFor(() => expect(requestCreate.mutate).toHaveBeenCalledTimes(1));
      const callbacks = requestCreate.mutate.mock.calls[0]?.[1] as Callbacks;
      act(() => { callbacks.onSuccess?.(); callbacks.onSettled?.(); });
      expect(value("Откуда")).toBe("");
      expect(value("Места")).toBe("3"); // Existing visible reset keeps the seat selection.
    } else {
      click("Отмена");
      expect(value("Места")).toBe("1");
      expect(closing).toHaveBeenLastCalledWith(false);
    }
    expect(readSessionDraft(getSessionDraftScope(user.id), "ride-request:create")).toBeUndefined();
    expectOtherDraft();
    view.unmount();
    render(createForm());
    expect(value("Откуда")).toBe("");
    expect(value("Не позже")).toBe("");
    expect(value("Места")).toBe("1");
  });

  it("failed city validation preserves input", () => {
    const view = render(createForm());
    change("Места", "3");
    change("Не раньше", createFields["Не раньше"]);
    click("Опубликовать запрос");
    expect(requestCreate.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Выберите города из справочника")).toBeTruthy();
    view.unmount();
    render(createForm());
    expect(value("Места")).toBe("3");
    expect(value("Не раньше")).toBe(createFields["Не раньше"]);
  });

  it("matching-trip navigation skips publish but preserves the draft", async () => {
    checkTrip.mockResolvedValue(false);
    const view = render(createForm());
    fill(createFields);
    click("Опубликовать запрос");
    await waitFor(() => expect(checkTrip).toHaveBeenCalledTimes(1));
    expect(requestCreate.mutate).not.toHaveBeenCalled();
    view.unmount();
    render(createForm());
    expectFields(createFields);
  });

  it("network failure preserves fields and allows retry, with one publish during precheck", async () => {
    const view = render(createForm());
    fill(createFields);
    click("Опубликовать запрос");
    click("Опубликовать запрос");
    await waitFor(() => expect(requestCreate.mutate).toHaveBeenCalledTimes(1));
    const callbacks = requestCreate.mutate.mock.calls[0]?.[1] as Callbacks;
    act(() => { callbacks.onError?.(); callbacks.onSettled?.(); });
    view.unmount();
    render(createForm());
    expectFields(createFields);
    click("Опубликовать запрос");
    await waitFor(() => expect(requestCreate.mutate).toHaveBeenCalledTimes(2));
  });
});

const editFields = {
  "Не раньше": "2030-06-02T09:15", "Не позже": "2030-06-02T19:45",
  "Действует до": "2030-06-03T12:30", "Места": "3",
};
describe("ride request edit: session drafts", () => {
  it("retains every field after accidental close/actual unmount and does not overwrite on startEdit", () => {
    const view = render(editForm());
    click("Редактировать");
    fill(editFields);
    view.unmount();
    render(editForm());
    click("Редактировать");
    expectFields(editFields);
    expect(closing).toHaveBeenLastCalledWith(true);
  });

  it.each(["success", "cancel"] as const)("%s clears only the entity draft, including reopening while mounted", (outcome) => {
    writeSessionDraft(getSessionDraftScope(user.id), "unrelated", "keep me");
    const view = render(editForm());
    click("Редактировать");
    fill(editFields);
    if (outcome === "success") {
      click("Сохранить");
      const callbacks = requestUpdate.mutate.mock.calls[0]?.[1] as Callbacks;
      act(() => { callbacks.onSuccess?.(); callbacks.onSettled?.(); });
    } else click("Отмена");
    expect(readSessionDraft(getSessionDraftScope(user.id), "ride-request:edit:request-1")).toBeUndefined();
    expectOtherDraft();
    click("Редактировать");
    expect(value("Места")).toBe("2");
    expect(value("Не раньше")).toBe("2030-06-01T09:00");
    view.unmount();
    render(editForm());
    click("Редактировать");
    expect(value("Места")).toBe("2");
  });

  it("validation failure retains the invalid field on unmount", () => {
    const view = render(editForm());
    click("Редактировать");
    fill(editFields);
    change("Не позже", editFields["Не раньше"]);
    click("Сохранить");
    expect(requestUpdate.mutate).not.toHaveBeenCalled();
    view.unmount();
    render(editForm());
    click("Редактировать");
    expect(value("Не позже")).toBe(editFields["Не раньше"]);
    expect(value("Действует до")).toBe(editFields["Действует до"]);
  });

  it("keeps the synchronous/pending guard and permits retry after failed mutation", () => {
    const view = render(editForm());
    click("Редактировать");
    fill(editFields);
    click("Сохранить");
    click("Сохранить");
    expect(requestUpdate.mutate).toHaveBeenCalledTimes(1);
    requestUpdate.isPending = true;
    view.rerender(editForm());
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Отмена" }) as HTMLButtonElement).disabled).toBe(true);
    const callbacks = requestUpdate.mutate.mock.calls[0]?.[1] as Callbacks;
    act(() => { callbacks.onError?.(); callbacks.onSettled?.(); });
    requestUpdate.isPending = false;
    view.rerender(editForm());
    expectFields(editFields);
    click("Сохранить");
    expect(requestUpdate.mutate).toHaveBeenCalledTimes(2);
    view.unmount();
    render(editForm());
    click("Редактировать");
    expectFields(editFields);
  });

  it("isolates entity drafts on a mounted entity switch", () => {
    const view = render(editForm());
    click("Редактировать");
    fill(editFields);
    view.rerender(editForm("request-2"));
    expect(value("Места")).toBe("2");
    expect(value("Не раньше")).toBe("2030-06-01T09:00");
    change("Места", "1");
    view.rerender(editForm());
    expectFields(editFields);
    view.rerender(editForm("request-2"));
    expect(value("Места")).toBe("1");
  });
});

describe("trip/request draft auth boundary", () => {
  it.each(["trip edit", "request create", "request edit"] as const)("%s resets mounted input on identity change and logout/relogin", async (family) => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const node = () => family === "trip edit" ? tripForm() : family === "request create" ? createForm() : editForm();
    const label = family === "trip edit" ? "Комментарий пассажирам" : "Места";
    const baseline = family === "trip edit" ? "Исходный комментарий" : family === "request create" ? "1" : "2";
    const input = family === "trip edit" ? "Private draft" : "3";
    const view = render(node());
    if (family === "request edit") click("Редактировать");
    change(label, input);
    act(() => authenticate("other-user"));
    expect(value(label)).toBe(baseline);
    act(() => authenticate());
    expect(value(label)).toBe(baseline);
    change(label, input);
    await act(async () => useAuthStore.getState().clearSession("draft test"));
    expect(value(label)).toBe(baseline);
    act(() => authenticate());
    view.unmount();
    render(node());
    if (family === "request edit") click("Редактировать");
    expect(value(label)).toBe(baseline);
    expect(storageWrite).not.toHaveBeenCalled();
  });
});
