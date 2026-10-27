// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ create: vi.fn(), trips: vi.fn(), bookings: vi.fn(), success: vi.fn() }));
vi.mock("@/api/reviews.api", () => ({ reviewsApi: { createReview: mocks.create } }));
vi.mock("@/queries/useReviewsQuery", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/queries/useReviewsQuery")>(),
  useMyReviewsQuery: () => ({ data: [], isLoading: false, error: null }),
  useAvailableReviewTripsQuery: mocks.trips,
  useUserReviewsInfiniteQuery: () => ({ data: { pages: [] }, isLoading: false, error: null }),
}));
vi.mock("@/queries/useBookingsQuery", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/queries/useBookingsQuery")>(),
  useTripBookingsQuery: mocks.bookings,
}));
vi.mock("@/queries/profile", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/queries/profile")>(),
  useProfileQuery: () => ({ data: USER, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useClosingConfirmation", () => ({ useClosingConfirmation: vi.fn() }));
vi.mock("@/utils/haptics", () => ({ haptic: { success: mocks.success, error: vi.fn(), selection: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

import { ReviewsBody, reviewTargetKey } from "@/pages/Reviews/ReviewsPage";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";
import type { ReviewDraft } from "@/helpers/reviewDraftCommit";

const USER = { id: "review-commit-owner", name: "Водитель", avatar: "", rating: 5, reviewsCount: 0, tripsCount: 0 };
const PASSENGERS = [{ ...USER, id: "p1", name: "Первый" }, { ...USER, id: "p2", name: "Второй" }];
const TRIP = {
  id: "t1", driver: USER, fromCity: "Вологда", toCity: "Тула", date: "24 октября", time: "10:00",
  durationMinutes: 90, distanceKm: 130, price: 500, seatsTotal: 3, seatsAvailable: 2,
  tags: [], status: "completed", autoComplete: false, matchingEnabled: true,
};
let client: QueryClient;
let resolve: (value: unknown) => void;
let reject: (error: Error) => void;
function form() {
  return render(<QueryClientProvider client={client}><AppRoot platform="base"><MemoryRouter><ReviewsBody initialTab="new" /></MemoryRouter></AppRoot></QueryClientProvider>);
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function value(label: string) {
  return screen.getByLabelText<HTMLInputElement>(label).value;
}
function cached(ownerId = USER.id) {
  return readSessionDraft<ReviewDraft>(getSessionDraftScope(ownerId), "review:new")?.value;
}
async function submit() {
  const editor = form();
  change("Кому оставить отзыв", "p2");
  change("Комментарий", "Другой адресат");
  change("Кому оставить отзыв", "p1");
  change("Комментарий", "Отправленный текст");
  fireEvent.click(screen.getByRole("button", { name: "Отправить отзыв" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create).toHaveBeenCalledWith({ tripId: "t1", targetUserId: "p1", rating: 5, text: "Отправленный текст" });
  return editor;
}
async function finish(error?: Error) {
  await act(async () => { if (error) reject(error); else resolve({ id: "review-created" }); });
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe(error ? "error" : "success"));
}
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  useAuthStore.setState({ status: "idle", user: null, session: null });
  useAuthStore.setState({ status: "authenticated", user: USER, session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 } });
  mocks.create.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
  mocks.trips.mockReturnValue({ data: [TRIP], isLoading: false, isError: false, error: null });
  mocks.bookings.mockReturnValue({ data: { pages: [{ items: PASSENGERS.map((passenger) => ({ status: "confirmed", passenger })) }] }, isLoading: false, isError: false, error: null });
});
afterEach(() => {
  cleanup();
  client.clear();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

describe("recipient commits with real TanStack mutation lifecycle", () => {
  it("unmounted success removes ONLY the unchanged submitted entry and keeps selections", async () => {
    const editor = await submit();
    editor.unmount();
    await finish();
    expect(cached()?.entries[reviewTargetKey("t1", "p1")]).toBeUndefined();
    expect(cached()?.entries[reviewTargetKey("t1", "p2")]?.text).toBe("Другой адресат");
    expect(cached()?.selectedPassengerId).toBe("p1");
    expect(cached()?.selectedTripId).toBe("t1");
    expect(mocks.success).not.toHaveBeenCalled();
    form();
    expect(value("Комментарий")).toBe("");
    change("Кому оставить отзыв", "p2");
    expect(value("Комментарий")).toBe("Другой адресат");
  });

  it("reopen before success synchronizes partial cleanup without changing a newer selection", async () => {
    const editor = await submit();
    editor.unmount();
    form();
    change("Кому оставить отзыв", "p2");
    change("Комментарий", "Новые правки другого адресата");
    await finish();
    expect(cached()?.entries[reviewTargetKey("t1", "p1")]).toBeUndefined();
    expect(value("Кому оставить отзыв")).toBe("p2");
    expect(value("Комментарий")).toBe("Новые правки другого адресата");
  });

  it("reopen before success retains a newer revision of the SAME recipient", async () => {
    const editor = await submit();
    editor.unmount();
    const reopened = form();
    change("Комментарий", "Новый текст первого адресата");
    await finish();
    expect(value("Комментарий")).toBe("Новый текст первого адресата");
    expect(cached()?.entries[reviewTargetKey("t1", "p2")]?.text).toBe("Другой адресат");
    reopened.unmount();
    form();
    expect(value("Комментарий")).toBe("Новый текст первого адресата");
  });

  it("failed unmounted review retains both recipients", async () => {
    const editor = await submit();
    editor.unmount();
    await finish(new Error("Network failure"));
    expect(cached()?.entries[reviewTargetKey("t1", "p1")]?.text).toBe("Отправленный текст");
    expect(cached()?.entries[reviewTargetKey("t1", "p2")]?.text).toBe("Другой адресат");
  });

  it("mounted success leaves a newer revision of the submitted recipient visible", async () => {
    await submit();
    change("Комментарий", "Новый текст в открытой форме");
    await finish();
    expect(value("Кому оставить отзыв")).toBe("p1");
    expect(value("Комментарий")).toBe("Новый текст в открытой форме");
    expect(cached()?.entries[reviewTargetKey("t1", "p1")]?.text).toBe("Новый текст в открытой форме");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each([USER.id, "another-review-owner"])("late success preserves a new login's review: %s", async (ownerId) => {
    await submit();
    const owner = { ...USER, id: ownerId };
    mocks.trips.mockReturnValue({ data: [{ ...TRIP, driver: owner }], isLoading: false, isError: false, error: null });
    act(() => {
      useAuthStore.setState({ status: "unauthenticated", user: null, session: null });
      useAuthStore.setState({ status: "authenticated", user: owner, session: { accessToken: "later-access", refreshToken: "later-refresh", expiresAt: 0 } });
    });
    change("Комментарий", "Отзыв новой сессии");
    await finish();
    expect(value("Комментарий")).toBe("Отзыв новой сессии");
    expect(cached(ownerId)?.entries[reviewTargetKey("t1", "p1")]?.text).toBe("Отзыв новой сессии");
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
