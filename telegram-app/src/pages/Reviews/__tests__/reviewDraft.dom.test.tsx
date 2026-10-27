// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@/types";

const mocks = vi.hoisted(() => ({ trips: vi.fn(), bookings: vi.fn(), mutate: vi.fn(), dirty: vi.fn() }));
vi.mock("@/queries/useReviewsQuery", () => ({
  useMyReviewsQuery: () => ({ data: [], isLoading: false, error: null }),
  useAvailableReviewTripsQuery: mocks.trips,
  useUserReviewsInfiniteQuery: () => ({ data: { pages: [] }, isLoading: false, error: null }),
  useCreateReviewMutation: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
}));
vi.mock("@/queries/useBookingsQuery", () => ({ useTripBookingsQuery: mocks.bookings }));
vi.mock("@/queries/profile", () => ({ useProfileQuery: () => ({ data: USER, isLoading: false, error: null }) }));
vi.mock("@/hooks/useClosingConfirmation", () => ({ useClosingConfirmation: mocks.dirty }));
vi.mock("@/utils/haptics", () => ({ haptic: { success: vi.fn(), error: vi.fn(), selection: vi.fn() } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

import { ReviewsBody, reviewTargetKey } from "@/pages/Reviews/ReviewsPage";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";
import { ApiError } from "@/api/client";

const USER: User = {
  id: "review-owner", name: "Водитель", avatar: "https://example.com/avatar.svg",
  rating: 5, reviewsCount: 0, tripsCount: 0,
};
const P1 = { ...USER, id: "p1", name: "Первый пассажир" };
const P2 = { ...USER, id: "p2", name: "Второй пассажир" };
function trip(id: string, driver = USER) {
  return {
    id, driver, fromCity: "Вологда", toCity: "Череповец", date: "24 октября", time: "10:00",
    durationMinutes: 90, distanceKm: 130, price: 500, seatsTotal: 3, seatsAvailable: 2,
    tags: [], status: "completed",
  };
}
const TRIPS = [trip("t1"), trip("t2"), trip("driver-trip-1", P1), trip("driver-trip-2", P2)];
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
function query(data = TRIPS) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}
function bookings(passengers = [P1, P2]) {
  return {
    data: { pages: [{ items: passengers.map((passenger) => ({ status: "confirmed", passenger })) }] },
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  };
}
function form() {
  return <AppRoot platform="base"><MemoryRouter><ReviewsBody initialTab="new" /></MemoryRouter></AppRoot>;
}
function text() {
  return screen.getByLabelText<HTMLTextAreaElement>("Комментарий").value;
}
function select(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function edit(text: string, rating = 3) {
  fireEvent.change(screen.getByLabelText("Комментарий"), { target: { value: text } });
  fireEvent.click(screen.getByRole("radio", { name: `Оценка ${rating} из 5` }));
}
function expectInput(value: string, rating = 5) {
  expect(text()).toBe(value);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: `Оценка ${rating} из 5` }).checked).toBe(true);
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Отправить отзыв" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutate.mockReset();
  useAuthStore.setState({ status: "idle", user: null, session: null });
  authenticate();
  mocks.trips.mockReturnValue(query());
  mocks.bookings.mockReturnValue(bookings());
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

describe("new review session drafts", () => {
  it("restores trip, recipient, rating and text after tab navigation and actual unmount", () => {
    const view = render(form());
    select("Поездка", "t2");
    select("Кому оставить отзыв", "p2");
    edit("Про второго пассажира", 2);
    expect(mocks.dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("tab", { name: "Мои" }));
    fireEvent.click(screen.getByRole("tab", { name: "Новая" }));
    expectInput("Про второго пассажира", 2);
    view.unmount();
    render(form());
    expect(screen.getByLabelText<HTMLSelectElement>("Поездка").value).toBe("t2");
    expect(screen.getByLabelText<HTMLSelectElement>("Кому оставить отзыв").value).toBe("p2");
    expectInput("Про второго пассажира", 2);
  });

  it("keeps text and rating separate for each trip/recipient, including different drivers", () => {
    render(form());
    edit("Пассажир один", 1);
    select("Кому оставить отзыв", "p2");
    expectInput("");
    edit("Пассажир два", 4);
    select("Поездка", "t2");
    expectInput("");
    edit("Другая поездка", 2);
    select("Поездка", "t1");
    expectInput("Пассажир один", 1);
    select("Кому оставить отзыв", "p2");
    expectInput("Пассажир два", 4);
    select("Поездка", "driver-trip-1");
    expectInput("");
    edit("Первый водитель", 3);
    select("Поездка", "driver-trip-2");
    expectInput("");
    edit("Второй водитель", 4);
    select("Поездка", "driver-trip-1");
    expectInput("Первый водитель", 3);
  });

  it("revalidates restored recipients; missing ids cannot silently become another passenger", () => {
    const view = render(form());
    edit("Только про первого", 1);
    view.unmount();
    mocks.bookings.mockReturnValue(bookings([P2]));
    render(form());
    const target = screen.getByLabelText("Кому оставить отзыв");
    expect(target.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText<HTMLSelectElement>("Кому оставить отзыв").value).toBe("");
    expectInput("");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить отзыв" }).disabled).toBe(true);
    select("Кому оставить отзыв", "p2");
    expectInput("");
    edit("Только про второго", 4);
    submit();
    expect(mocks.mutate).toHaveBeenCalledWith(
      { tripId: "t1", targetUserId: "p2", rating: 4, text: "Только про второго", onCommitted: expect.any(Function) },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("revalidates restored trips without transplanting their input to another available trip", () => {
    const view = render(form());
    edit("Первая поездка", 1);
    view.unmount();
    mocks.trips.mockReturnValue(query([TRIPS[1]!]));
    render(form());
    expect(screen.getByLabelText("Поездка").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText<HTMLSelectElement>("Поездка").value).toBe("");
    expectInput("");
    select("Поездка", "t2");
    expectInput("");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each([
    new Error("Network"), new ApiError("Already reviewed", "ALREADY_REVIEWED", 409), new ApiError("Too many", "RATE_LIMITED", 429),
  ])("failed request retains input and permits retry after reopen: %s", (error) => {
    let callbacks: Callbacks | undefined;
    mocks.mutate.mockImplementation((_data: unknown, options: Callbacks) => { callbacks = options; });
    const view = render(form());
    edit("Черновик отзыва", 2);
    submit();
    act(() => { callbacks!.onError(error); callbacks!.onSettled(); });
    expectInput("Черновик отзыва", 2);
    view.unmount();
    render(form());
    expectInput("Черновик отзыва", 2);
    submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it("success removes only the submitted trip/recipient while retaining another recipient's draft", () => {
    let callbacks: Callbacks | undefined;
    mocks.mutate.mockImplementation((_data: unknown, options: Callbacks) => { callbacks = options; });
    const view = render(form());
    edit("Первый отзыв", 1);
    submit();
    select("Кому оставить отзыв", "p2");
    edit("Второй черновик", 4);
    act(() => { callbacks!.onSuccess(); callbacks!.onSettled(); });
    expectInput("Второй черновик", 4);
    const cached = readSessionDraft<{ entries: Record<string, { text: string }> }>(getSessionDraftScope(USER.id), "review:new");
    expect(cached?.value.entries[reviewTargetKey("t1", "p1")]).toBeUndefined();
    expect(cached?.value.entries[reviewTargetKey("t1", "p2")]?.text).toBe("Второй черновик");
    view.unmount();
    render(form());
    expectInput("Второй черновик", 4);
    select("Кому оставить отзыв", "p1");
    expectInput("");
  });

  it("success followed by reopen never restores submitted text/rating", () => {
    mocks.mutate.mockImplementation((_data: unknown, options: Callbacks) => {
      options.onSuccess(); options.onSettled();
    });
    const view = render(form());
    edit("Отправленный отзыв", 1);
    submit();
    view.unmount();
    render(form());
    expectInput("");
  });

  it("logout clears selection and private review entries for the next user", () => {
    const view = render(form());
    select("Поездка", "driver-trip-2");
    edit("Приватный текст", 1);
    view.unmount();
    useAuthStore.setState({ status: "unauthenticated", user: null, session: null });
    authenticate("another-user");
    render(form());
    expectInput("");
    expect(screen.getByLabelText<HTMLSelectElement>("Поездка").value).toBe("t1");
  });
});
