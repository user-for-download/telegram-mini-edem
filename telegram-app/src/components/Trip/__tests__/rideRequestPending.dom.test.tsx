// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { RideRequest } from "@edem/contracts";
import { RideRequestDetailsBody } from "../RideRequestDetailsModal";

const { mutation } = vi.hoisted(() => ({
  mutation: { mutate: vi.fn(), isPending: false, error: null },
}));
vi.mock("@/queries/useRideRequestsQuery", () => ({
  useUpdateRideRequestMutation: () => mutation,
  useRideRequestStatusMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelRideRequestMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const request: RideRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  fromCity: { id: "c-1", name: "Москва" },
  toCity: { id: "c-2", name: "Тула" },
  earliestAt: "2030-01-02T10:00:00.000Z",
  latestAt: "2030-01-02T14:00:00.000Z",
  expiresAt: "2030-01-02T14:00:00.000Z",
  seats: 2,
  status: "active",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  mutation.isPending = false;
  vi.clearAllMocks();
});

function show() {
  return <AppRoot platform="base"><RideRequestDetailsBody request={request} onClose={vi.fn()} /></AppRoot>;
}

describe("RideRequestDetailsBody: защита сохранения", () => {
  it("блокирует кнопку во время pending и снова разрешает после завершения", () => {
    const view = render(show());
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    mutation.isPending = true;
    view.rerender(show());
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    expect(mutation.mutate).not.toHaveBeenCalled();

    mutation.isPending = false;
    view.rerender(show());
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it("не отправляет второй запрос до обновления pending-состояния", () => {
    render(show());
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const save = screen.getByRole("button", { name: "Сохранить" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
  });

  it("разрешает повтор после завершения неуспешного запроса", () => {
    render(show());
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const save = screen.getByRole("button", { name: "Сохранить" });
    fireEvent.click(save);
    const callbacks = mutation.mutate.mock.calls[0]?.[1] as { onSettled: () => void };
    callbacks.onSettled();
    fireEvent.click(save);
    expect(mutation.mutate).toHaveBeenCalledTimes(2);
  });
});
