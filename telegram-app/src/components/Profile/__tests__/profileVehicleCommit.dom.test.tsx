// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import type { User } from "@edem/contracts";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), toast: vi.fn() }));
vi.mock("@/api/profile", () => ({ profileApi: { getCurrentUser: mocks.read, updateProfile: mocks.save } }));
vi.mock("@/api/vehicle", () => ({ vehicleApi: { upsertVehicle: mocks.save, removeVehicle: vi.fn() } }));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: mocks.toast }) }));
vi.mock("@/hooks/useClosingConfirmation", () => ({ useClosingConfirmation: vi.fn() }));
vi.mock("@/utils/haptics", () => ({ haptic: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

import { EditProfileBody } from "@/components/Profile/EditProfileModal";
import { VehicleBody } from "@/components/Profile/VehicleModal";
import { PROFILE_KEYS } from "@/queries/profile";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";

const ALICE: User = {
  id: "alice-commit", name: "Алиса", about: "Текст Алисы", phone: "+79001234567",
  avatar: "", rating: 5, reviewsCount: 0, tripsCount: 0,
  car: { model: "Skoda Алисы", color: "белый", plate: "ALICE" },
};
const BOB: User = {
  ...ALICE, id: "bob-commit", name: "Борис", about: "Текст Бориса", phone: "+79007654321",
  car: { model: "Kia Бориса", color: "синий", plate: "BOB" },
};
const families = [
  {
    name: "profile", Component: EditProfileBody, field: "Имя", save: "Сохранить изменения",
    key: `profile:edit:${ALICE.id}`, initial: ALICE.name, fresh: BOB.name,
    response: { ...ALICE, name: "Отправленное имя" }, edited: "Отправленное имя",
    dto: { name: "Отправленное имя", about: ALICE.about, phone: ALICE.phone },
  },
  {
    name: "vehicle", Component: VehicleBody, field: "Модель", save: "Сохранить автомобиль",
    key: `vehicle:${ALICE.id}:existing`, initial: ALICE.car!.model, fresh: BOB.car!.model,
    response: { ...ALICE, car: { ...ALICE.car!, model: "Отправленная машина" } }, edited: "Отправленная машина",
    dto: { model: "Отправленная машина", color: ALICE.car!.color, plate: ALICE.car!.plate },
  },
];

let client: QueryClient;
let resolveSave: (user: User) => void;
let resolveRead: (user: User) => void;
function authenticate(user: User) {
  useAuthStore.setState({ status: "authenticated", user, session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 } });
}
function form(Component: ComponentType<{ onDone: () => void }>, done = vi.fn()) {
  return render(<QueryClientProvider client={client}><AppRoot platform="base"><MemoryRouter><Component onDone={done} /></MemoryRouter></AppRoot></QueryClientProvider>);
}
function input(label: string) {
  return screen.getByLabelText<HTMLInputElement>(label);
}
function change(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } });
}
async function succeed(user: User) {
  await act(async () => resolveSave(user));
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe("success"));
}
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate(ALICE);
  // Leave a fresh legacy record as well: owner switching cannot rely on staleness.
  client.setQueryData(PROFILE_KEYS.current(), ALICE);
  client.setQueryData(PROFILE_KEYS.current(ALICE.id), ALICE);
  mocks.save.mockReturnValue(new Promise<User>((resolve) => { resolveSave = resolve; }));
  mocks.read.mockReturnValue(new Promise<User>((resolve) => { resolveRead = resolve; }));
});
afterEach(() => {
  cleanup();
  client.clear();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

describe.each(families)("$name real-query form commit", (family) => {
  function cached() {
    return readSessionDraft(getSessionDraftScope(ALICE.id), family.key);
  }

  it("a valid pristine form can finish without a previously cached draft", async () => {
    const done = vi.fn(() => expect(cached()).toBeUndefined());
    form(family.Component, done);
    expect(input(family.field).value).toBe(family.initial);
    expect(cached()).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: family.save }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0]).not.toHaveProperty("onCommitted");
    await succeed(ALICE);
    expect(done).toHaveBeenCalledTimes(1);
    expect(cached()).toBeUndefined();
  });

  it("success after actual unmount commits without running UI close", async () => {
    const done = vi.fn();
    const editor = form(family.Component, done);
    change(family.field, family.edited);
    fireEvent.click(screen.getByRole("button", { name: family.save }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(family.dto));
    editor.unmount();
    await succeed(family.response);
    expect(cached()).toBeUndefined();
    expect(done).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    form(family.Component);
    expect(input(family.field).value).toBe(family.edited);
  });

  it.each([false, true])("reopened editor follows committed server data, retaining newer edits=%s", async (edit) => {
    const editor = form(family.Component);
    change(family.field, family.edited);
    fireEvent.click(screen.getByRole("button", { name: family.save }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    editor.unmount();
    form(family.Component);
    if (edit) change(family.field, "Новая правка");
    await succeed(family.response);
    expect(input(family.field).value).toBe(edit ? "Новая правка" : family.edited);
    expect(Boolean(cached())).toBe(edit);
    act(() => client.setQueryData(PROFILE_KEYS.current(ALICE.id), {
      ...ALICE, name: "Поздний refetch", car: { ...ALICE.car!, model: "Поздний refetch" },
    }));
    await waitFor(() => expect(input(family.field).value).toBe(edit ? "Новая правка" : "Поздний refetch"));
  });

  it("fresh cached Alice data cannot initialize or cache Bob's private form", async () => {
    form(family.Component);
    change(family.field, "Приватный черновик Алисы");
    act(() => authenticate(BOB));
    expect(screen.queryByLabelText(family.field)).toBeNull();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    // Even wrongly hydrated scoped data must be withheld by the form owner guard.
    act(() => client.setQueryData(PROFILE_KEYS.current(BOB.id), ALICE));
    await waitFor(() => expect(screen.queryByLabelText(family.field)).toBeNull());
    expect(readSessionDraft(getSessionDraftScope(BOB.id), family.key)).toBeUndefined();
    expect(readSessionDraft(getSessionDraftScope(BOB.id), "profile:edit:loading")).toBeUndefined();
    expect(readSessionDraft(getSessionDraftScope(BOB.id), "vehicle:loading:new")).toBeUndefined();
    await act(async () => resolveRead(BOB));
    await waitFor(() => expect(input(family.field).value).toBe(family.fresh));
  });
});
