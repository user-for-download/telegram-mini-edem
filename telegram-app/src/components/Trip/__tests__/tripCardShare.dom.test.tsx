// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Trip, } from "@edem/contracts";
import { TripCard } from "../TripCard";

const { share, show } = vi.hoisted(() => ({ share: vi.fn(), show: vi.fn() }));
vi.mock("@/helpers/tripShare", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/helpers/tripShare")>(),
  shareTrip: share,
}));
vi.mock("@/components/Toast/ToastProvider", () => ({ useToast: () => ({ show }) }));
vi.mock("@/utils/haptics", () => ({ haptic: { light: vi.fn(), success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TripCard: share feedback", () => {
  it.each([
    ["failed", "error", "Не удалось поделиться"],
    ["cancelled", "info", "Отправка отменена"],
    ["copied", "success", "Ссылка скопирована"],
  ])("%s не скрывает исход действия", async (result, tone, message) => {
    share.mockResolvedValue(result);
    const trip = {
      id: "share-trip", fromCity: "Москва", toCity: "Тула", date: "2030-06-01", time: "09:00",
      departureAt: "2030-06-01T06:00:00.000Z", durationMinutes: 60, distanceKm: 100, price: 500,
      seatsTotal: 3, seatsAvailable: 3, driver: { id: "me", name: "Водитель", rating: 0, reviewsCount: 0, tripsCount: 0 },
      tags: [], status: "active", autoComplete: false, matchingEnabled: true, pendingRequestsCount: 0,
    } as unknown as Trip;
    render(<AppRoot platform="base"><MemoryRouter><TripCard variant={{ kind: "driving", trip, onCancel: vi.fn(), cancelPending: false }} /></MemoryRouter></AppRoot>);
    fireEvent.click(screen.getByRole("button", { name: "Поделиться поездкой" }));
    await waitFor(() => expect(show).toHaveBeenCalledWith({ text: expect.stringContaining(message), tone }));
    expect(share).toHaveBeenCalledWith("share-trip");
  });
});
