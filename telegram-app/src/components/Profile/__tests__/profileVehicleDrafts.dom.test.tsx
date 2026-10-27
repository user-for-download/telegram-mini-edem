// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@/types";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  vehicle: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  dirty: vi.fn(),
}));
vi.mock("@/queries/profile", () => ({
  useProfileQuery: mocks.profile,
  useProfileUpdateMutation: () => ({ mutate: mocks.update, isPending: false, error: null }),
}));
vi.mock("@/queries/vehicle", () => ({
  useVehicleQuery: mocks.vehicle,
  useUpsertVehicleMutation: () => ({ mutate: mocks.upsert, isPending: false, error: null, reset: vi.fn() }),
  useRemoveVehicleMutation: () => ({ mutate: mocks.remove, isPending: false, isError: false }),
}));
vi.mock("@/hooks/useClosingConfirmation", () => ({ useClosingConfirmation: mocks.dirty }));
vi.mock("@/utils/haptics", () => ({ haptic: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({
  getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn(),
}));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock("@/components/ConfirmPopup", () => ({
  ConfirmPopup: ({ label, onConfirm }: { label: string; onConfirm: () => void }) => (
    <button type="button" onClick={onConfirm}>{label}</button>
  ),
}));

import { EditProfileBody } from "@/components/Profile/EditProfileModal";
import { VehicleBody } from "@/components/Profile/VehicleModal";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";

const USER: User = {
  id: "draft-owner", name: "Пётр", about: "О себе", phone: "+79001234567",
  avatar: "https://example.com/avatar.svg", rating: 5, reviewsCount: 0, tripsCount: 0,
  isVerified: true, notificationsEnabled: true, verifiedAt: null, onboardingVersion: null,
  createdAt: "2026-10-24T00:00:00.000Z",
};
const CAR = { model: "Skoda", color: "белый", plate: "583" };
interface Callbacks {
  onSuccess: () => void;
  onError?: (error: Error) => void;
  onSettled: () => void;
}

function authenticate(id = USER.id) {
  useAuthStore.setState({
    status: "authenticated", user: { ...USER, id },
    session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 },
  });
}
function query(data: unknown, vehicle: typeof CAR | null = CAR) {
  return { data, vehicle, error: null, isLoading: false, refetch: vi.fn() };
}
function wrap(node: ReactNode) {
  return <AppRoot platform="base"><MemoryRouter>{node}</MemoryRouter></AppRoot>;
}
function input(label: string) {
  return screen.getByLabelText<HTMLInputElement>(label);
}
function change(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockReset();
  mocks.upsert.mockReset();
  mocks.remove.mockReset();
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate();
  mocks.profile.mockReturnValue(query(USER));
  mocks.vehicle.mockReturnValue(query({ ...USER, car: CAR }));
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

const families = [
  {
    name: "profile", Component: EditProfileBody, mutate: mocks.update,
    key: `profile:edit:${USER.id}`, save: "Сохранить изменения",
    fields: ["Имя", "О себе", "Телефон"],
    initial: [USER.name, USER.about, USER.phone], edited: ["Марина", "Черновик", "+79007654321"],
  },
  {
    name: "vehicle", Component: VehicleBody, mutate: mocks.upsert,
    key: `vehicle:${USER.id}:existing`, save: "Сохранить автомобиль",
    fields: ["Модель", "Цвет", "Номер (необязательно)"],
    initial: [CAR.model, CAR.color, CAR.plate], edited: ["Kia Rio", "синий", "А123"],
  },
];

describe.each(families)("$name session draft", ({ Component, mutate, key, save, fields, initial, edited }) => {
  const edit = () => fields.forEach((label, index) => change(label, edited[index]!));
  const expectFields = (values: Array<string | undefined>) =>
    fields.forEach((label, index) => expect(input(label).value).toBe(values[index]));

  it("retains all fields after actual unmount/remount and query refetch", () => {
    const view = render(wrap(<Component onDone={vi.fn()} />));
    expectFields(initial);
    edit();
    expect(mocks.dirty).toHaveBeenLastCalledWith(true);
    view.unmount();
    mocks.profile.mockReturnValue(query({ ...USER, name: "Сервер", about: "Сервер" }));
    mocks.vehicle.mockReturnValue(query({ ...USER, car: CAR }, { ...CAR, model: "Сервер" }));
    render(wrap(<Component onDone={vi.fn()} />));
    expectFields(edited);
  });

  it("explicit Cancel clears before closing and does not resurrect on exit", () => {
    const done = vi.fn(() => {
      expect(readSessionDraft(getSessionDraftScope(USER.id), key)).toBeUndefined();
    });
    const view = render(wrap(<Component onDone={done} />));
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(done).toHaveBeenCalledTimes(1);
    view.unmount();
    render(wrap(<Component onDone={vi.fn()} />));
    expectFields(initial);
  });

  it("success clears before onDone; failed requests retain input and allow retry", () => {
    let callbacks: Callbacks | undefined;
    mutate.mockImplementation((_data: unknown, options: Callbacks) => { callbacks = options; });
    const done = vi.fn(() => {
      expect(readSessionDraft(getSessionDraftScope(USER.id), key)).toBeUndefined();
    });
    const view = render(wrap(<Component onDone={done} />));
    edit();
    fireEvent.click(screen.getByRole("button", { name: save }));
    act(() => {
      callbacks!.onError?.(new Error("Network"));
      callbacks!.onSettled();
    });
    view.unmount();
    const reopened = render(wrap(<Component onDone={done} />));
    expectFields(edited);
    fireEvent.click(screen.getByRole("button", { name: save }));
    act(() => { callbacks!.onSuccess(); callbacks!.onSettled(); });
    expect(done).toHaveBeenCalledTimes(1);
    reopened.unmount();
    render(wrap(<Component onDone={vi.fn()} />));
    expectFields(initial);
  });

  it("withholds another owner's response without leaking or discarding the current draft", () => {
    const view = render(wrap(<Component onDone={vi.fn()} />));
    edit();
    mocks.profile.mockReturnValue(query({ ...USER, id: "other-entity" }));
    mocks.vehicle.mockReturnValue(query({ ...USER, id: "other-entity", car: CAR }));
    view.rerender(wrap(<Component onDone={vi.fn()} />));
    fields.forEach((label) => expect(screen.queryByLabelText(label)).toBeNull());
    mocks.profile.mockReturnValue(query(USER));
    mocks.vehicle.mockReturnValue(query({ ...USER, car: CAR }));
    view.rerender(wrap(<Component onDone={vi.fn()} />));
    expectFields(edited);
  });

  it("logout and another user cannot restore previous private fields", () => {
    const view = render(wrap(<Component onDone={vi.fn()} />));
    edit();
    view.unmount();
    useAuthStore.setState({ status: "unauthenticated", user: null, session: null });
    authenticate("another-user");
    mocks.profile.mockReturnValue(query({ ...USER, id: "another-user" }));
    mocks.vehicle.mockReturnValue(query({ ...USER, id: "another-user", car: CAR }));
    const reopened = render(wrap(<Component onDone={vi.fn()} />));
    expectFields(initial);
    reopened.unmount();
    authenticate();
    mocks.profile.mockReturnValue(query(USER));
    mocks.vehicle.mockReturnValue(query({ ...USER, car: CAR }));
    render(wrap(<Component onDone={vi.fn()} />));
    expectFields(initial);
  });
});

it("vehicle creation is separate from editing and deletion clears the edited car", () => {
  const view = render(wrap(<VehicleBody onDone={vi.fn()} />));
  change("Модель", "Kia Rio");
  mocks.remove.mockImplementation((_data: unknown, callbacks: Callbacks) => callbacks.onSuccess());
  fireEvent.click(screen.getByRole("button", { name: "Удалить автомобиль" }));
  expect(readSessionDraft(getSessionDraftScope(USER.id), `vehicle:${USER.id}:existing`)).toBeUndefined();
  mocks.vehicle.mockReturnValue(query({ ...USER, car: null }, null));
  view.rerender(wrap(<VehicleBody onDone={vi.fn()} />));
  expect(input("Модель").value).toBe("");
  change("Модель", "Новая машина");
  view.unmount();
  const reopened = render(wrap(<VehicleBody onDone={vi.fn()} />));
  expect(input("Модель").value).toBe("Новая машина");
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  reopened.unmount();
  render(wrap(<VehicleBody onDone={vi.fn()} />));
  expect(input("Модель").value).toBe("");
});

it("clearing the vehicle draft does not discard the profile draft", () => {
  const profile = render(wrap(<EditProfileBody onDone={vi.fn()} />));
  change("Имя", "Черновик профиля");
  profile.unmount();
  const vehicle = render(wrap(<VehicleBody onDone={vi.fn()} />));
  change("Модель", "Kia Rio");
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  vehicle.unmount();
  render(wrap(<EditProfileBody onDone={vi.fn()} />));
  expect(input("Имя").value).toBe("Черновик профиля");
});

it("vehicle fields initialize when profile data arrives after the loading render", () => {
  mocks.vehicle.mockReturnValue({ ...query(undefined, null), isLoading: true });
  const view = render(wrap(<VehicleBody onDone={vi.fn()} />));
  expect(screen.queryByLabelText("Модель")).toBeNull();
  mocks.vehicle.mockReturnValue(query({ ...USER, car: CAR }));
  view.rerender(wrap(<VehicleBody onDone={vi.fn()} />));
  expect(input("Модель").value).toBe(CAR.model);
  expect(input("Цвет").value).toBe(CAR.color);
  expect(input("Номер (необязательно)").value).toBe(CAR.plate);
});
