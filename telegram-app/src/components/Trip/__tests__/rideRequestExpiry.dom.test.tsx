// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { RideRequest } from "@edem/contracts";
import { RideRequestDetailsBody } from "../RideRequestDetailsModal";

const { update, status } = vi.hoisted(() => ({ update: vi.fn(), status: vi.fn() }));
vi.mock("@/queries/useRideRequestsQuery", () => ({
  useUpdateRideRequestMutation: () => ({ mutate: update, isPending: false }),
  useRideRequestStatusMutation: () => ({ mutate: status, isPending: false }),
  useCancelRideRequestMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime("2030-01-01T10:00:00Z"); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

function show(requestStatus: RideRequest["status"] = "active") {
  const request: RideRequest = {
    id: "11111111-1111-4111-8111-111111111111",
    fromCity: { id: "c-1", name: "Москва" }, toCity: { id: "c-2", name: "Тула" },
    earliestAt: "2030-01-01T10:00:00Z", latestAt: "2030-01-01T12:00:00Z",
    expiresAt: "2030-01-01T10:00:01Z", seats: 1, status: requestStatus,
    createdAt: "2030-01-01T09:00:00Z", updatedAt: "2030-01-01T09:00:00Z",
  };
  render(<AppRoot platform="base"><RideRequestDetailsBody request={request} onClose={vi.fn()} /></AppRoot>);
}

describe("Ride request: live expiry", () => {
  it.each(["active", "paused"] as const)("%s перестаёт предлагать управление на границе срока", (requestStatus) => {
    show(requestStatus);
    expect(screen.getByRole("button", { name: "Редактировать" })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole("button", { name: "Редактировать" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Срок действия истёк");
  });

  it("не теряет открытый ввод, но запрещает сохранение после срока", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Места" }), { target: { value: "2" } });
    act(() => { vi.advanceTimersByTime(1000); });
    expect((screen.getByRole("spinbutton", { name: "Места" }) as HTMLInputElement).value).toBe("2");
    const save = screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(update).not.toHaveBeenCalled();
  });

  it("handler не отправляет действие, даже если таймер ещё не отрисовал истечение", () => {
    show();
    const pause = screen.getByRole("button", { name: "На паузу" });
    vi.setSystemTime("2030-01-01T10:00:02Z");
    fireEvent.click(pause);
    expect(status).not.toHaveBeenCalled();
  });

  it("терминальный статус не подменяется истечением", () => {
    show("fulfilled");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Выполнен")).toBeTruthy();
    expect(screen.queryByText(/Срок действия истёк/)).toBeNull();
  });
});
