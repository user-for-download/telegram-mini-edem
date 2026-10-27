// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreateTripDto } from "@edem/contracts";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/api/profile", () => ({ profileApi: { updateProfile: mocks.request } }));
vi.mock("@/api/vehicle", () => ({ vehicleApi: { upsertVehicle: mocks.request, removeVehicle: mocks.request } }));
vi.mock("@/api/trips.api", () => ({ tripsApi: { createTrip: mocks.request, updateTrip: mocks.request } }));
vi.mock("@/api/rideRequests.api", () => ({ rideRequestsApi: { create: mocks.request, update: mocks.request, cancel: mocks.request } }));
vi.mock("@/api/support", () => ({ supportApi: { create: mocks.request, appeal: mocks.request } }));
vi.mock("@/api/reports", () => ({ reportsApi: { create: mocks.request } }));
vi.mock("@/api/reviews.api", () => ({ reviewsApi: { createReview: mocks.request } }));
vi.mock("@/api/bookings.api", () => ({ bookingsApi: { createBooking: mocks.request } }));
vi.mock("@/utils/telegram-adapter", () => ({ getRawInitData: vi.fn(), purgeLaunchParamsCache: vi.fn() }));

import { useProfileUpdateMutation } from "@/queries/profile";
import { useUpsertVehicleMutation, useRemoveVehicleMutation } from "@/queries/vehicle";
import { useCreateTripMutation, useUpdateTripMutation } from "@/queries/useTripsQuery";
import { useCreateRideRequestMutation, useUpdateRideRequestMutation, useCancelRideRequestMutation } from "@/queries/useRideRequestsQuery";
import { useCreateFeedbackMutation, useAppealFeedbackMutation } from "@/queries/useSupportQuery";
import { useCreateReportMutation } from "@/queries/useReportQuery";
import { useCreateReviewMutation } from "@/queries/useReviewsQuery";
import { useCreateBookingMutation } from "@/queries/useBookingsQuery";
import type { WithCommit } from "@/queries/useCommittedMutation";
import { useCommittedMutation } from "@/queries/useCommittedMutation";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { useAuthStore } from "@/store/useAuthStore";
import { getSessionDraftScope, readSessionDraft } from "@/helpers/sessionDrafts";

const USER = { id: "commit-owner", name: "Автор", avatar: "", rating: 5, reviewsCount: 0, tripsCount: 0 };
const CREATE_TRIP: CreateTripDto = {
  fromCity: "Вологда", toCity: "Тула", fromAddress: "", toAddress: "",
  fromCityId: "11111111-1111-4111-8111-111111111111", toCityId: "22222222-2222-4222-8222-222222222222",
  departureAt: "2030-06-01T08:00:00.000Z", durationMinutes: 60, distanceKm: 100,
  price: 500, seatsTotal: 1, tags: [], autoComplete: false, matchingEnabled: true,
};

// Each adapter calls a REAL project mutation hook, not a mocked mutate callback.
function mutationCase<T extends object>(
  name: string,
  useHook: () => { mutate: (variables: WithCommit<T>, options: { onSuccess: () => void }) => void },
  variables: T,
  apiArgs: unknown[] = [variables],
) {
  return {
    name, apiArgs,
    useEditor() {
      const mutation = useHook();
      const [value, setValue, , captureSubmission] = useSessionDraft(`test:${name}`, "");
      return {
        value, setValue,
        submit: (onSuccess: () => void) => {
          const onCommitted = vi.fn(captureSubmission());
          mutation.mutate({ ...variables, onCommitted }, { onSuccess });
          return onCommitted;
        },
      };
    },
  };
}

const feedback = { subject: "Тема", text: "Сообщение" };
const families = [
  mutationCase("profile", useProfileUpdateMutation, { name: "Новое имя" }),
  mutationCase("vehicle", useUpsertVehicleMutation, { model: "Skoda", color: "белый" }),
  mutationCase("vehicle-remove", useRemoveVehicleMutation, {}, []),
  mutationCase("trip-create", useCreateTripMutation, CREATE_TRIP),
  mutationCase("trip-update", useUpdateTripMutation, { id: "t1", data: { comment: "" } }, ["t1", { comment: "" }]),
  mutationCase("request-create", useCreateRideRequestMutation, {
    fromCityId: "c1", toCityId: "c2", earliestAt: "2030-06-01T08:00:00.000Z", latestAt: "2030-06-01T12:00:00.000Z",
    expiresAt: "2030-06-01T12:00:00.000Z", seats: 1,
  }),
  mutationCase("request-update", useUpdateRideRequestMutation, { id: "r1", data: { seats: 2 } }, ["r1", { seats: 2 }]),
  mutationCase("request-cancel", useCancelRideRequestMutation, { id: "r1" }, ["r1"]),
  mutationCase("support", useCreateFeedbackMutation, feedback),
  mutationCase("appeal", useAppealFeedbackMutation, feedback, [{ initData: "test-init-data", ...feedback }]),
  mutationCase("report", useCreateReportMutation, { targetType: "trip" as const, targetId: "t1", category: "safety" as const, description: "Описание" }),
  mutationCase("review", useCreateReviewMutation, { tripId: "t1", targetUserId: "p1", rating: 5, text: "Отзыв" }),
  mutationCase("booking", useCreateBookingMutation, { tripId: "t1", seat: 1, comment: "Комментарий" }),
];

let client: QueryClient;
let resolve: (value: unknown) => void;
let reject: (error: Error) => void;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it("cleanup survives a failing cache-side success handler after the server committed", async () => {
  const committed = vi.fn(() => true);
  const hook = renderHook(() => useCommittedMutation({
    mutationFn: (_data: { value: string }) => mocks.request(),
    onSuccess: () => { throw new Error("Cache side effect failed"); },
  }), { wrapper: Wrapper });
  act(() => hook.result.current.mutate({ value: "submitted", onCommitted: committed }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  await act(async () => { resolve(USER); });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(committed).toHaveBeenCalledTimes(1);
});
async function finish(error?: Error) {
  await act(async () => { if (error) reject(error); else resolve(USER); });
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe(error ? "error" : "success"));
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  useAuthStore.setState({ status: "idle", user: null, session: null });
  useAuthStore.setState({ status: "authenticated", user: USER, initData: "test-init-data", session: { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0 } });
  mocks.request.mockReset();
  mocks.request.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
});
afterEach(() => {
  cleanup();
  client.clear();
  useAuthStore.setState({ status: "idle", user: null, session: null });
});

describe.each(families)("$name execution-owned draft commit", (family) => {
  function cached() {
    return readSessionDraft<string>(getSessionDraftScope(USER.id), `test:${family.name}`)?.value;
  }
  async function submit() {
    const editor = renderHook(() => family.useEditor(), { wrapper: Wrapper });
    act(() => editor.result.current.setValue("submitted"));
    const onSuccess = vi.fn();
    let onCommitted: ReturnType<typeof editor.result.current.submit>;
    act(() => { onCommitted = editor.result.current.submit(onSuccess); });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(mocks.request.mock.calls[0]).toEqual(family.apiArgs);
    return { editor, onSuccess, onCommitted: onCommitted! };
  }

  it("clears successful submitted data after unmount without invoking observer UI", async () => {
    const { editor, onSuccess, onCommitted } = await submit();
    editor.unmount();
    expect(cached()).toBe("submitted");
    await finish();
    expect(cached()).toBeUndefined();
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    const reopened = renderHook(() => family.useEditor(), { wrapper: Wrapper });
    expect(reopened.result.current.value).toBe("");
  });

  it.each([false, true])("reopen before success observes cleanup, but retains newer edits=%s", async (edit) => {
    const { editor, onSuccess } = await submit();
    editor.unmount();
    const reopened = renderHook(() => family.useEditor(), { wrapper: Wrapper });
    expect(reopened.result.current.value).toBe("submitted");
    if (edit) act(() => reopened.result.current.setValue("newer input"));
    await finish();
    expect(reopened.result.current.value).toBe(edit ? "newer input" : "");
    expect(cached()).toBe(edit ? "newer input" : undefined);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("never clears an unmounted failed submission", async () => {
    const { editor, onCommitted } = await submit();
    editor.unmount();
    await finish(new Error("Network failure"));
    expect(cached()).toBe("submitted");
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("a pristine authenticated submission can finish and run mounted UI", async () => {
    const editor = renderHook(() => family.useEditor(), { wrapper: Wrapper });
    expect(cached()).toBeUndefined();
    const onSuccess = vi.fn(() => expect(cached()).toBeUndefined());
    let onCommitted: ReturnType<typeof editor.result.current.submit>;
    act(() => { onCommitted = editor.result.current.submit(onSuccess); });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(mocks.request.mock.calls[0]).toEqual(family.apiArgs);
    expect(cached()).toBe("");
    await finish();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onCommitted!()).toBe(true);
  });

  it.each([USER.id, "foreign-owner"])("old success cannot clear a later login's draft: %s", async (ownerId) => {
    const { editor, onCommitted } = await submit();
    editor.unmount();
    useAuthStore.setState({ status: "unauthenticated", user: null, session: null });
    useAuthStore.setState({ status: "authenticated", user: { ...USER, id: ownerId }, session: { accessToken: "later-access", refreshToken: "later-refresh", expiresAt: 0 } });
    const reopened = renderHook(() => family.useEditor(), { wrapper: Wrapper });
    act(() => reopened.result.current.setValue("later session"));
    await finish();
    expect(readSessionDraft<string>(getSessionDraftScope(ownerId), `test:${family.name}`)?.value).toBe("later session");
    expect(reopened.result.current.value).toBe("later session");
    expect(onCommitted).toHaveReturnedWith(false);
  });
});
