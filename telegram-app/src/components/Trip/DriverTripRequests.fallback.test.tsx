// @vitest-environment jsdom
// A5 ConfirmFallback: тап по «принять»/«отклонить» без доступного popup
// (старый клиент, Bot API < 6.2) обязан дать видимый исход — тост, а не
// молчаливый no-op. До фикса `if (!confirmed) return` гасил и отказ, и
// «спросить нечем» одинаково: пользователь жал кнопку, ничего не
// происходило и ничего не объяснялось.
//
// Различие веток — осознанное: отказ при доступном popup — тишина
// (пользователь сам передумал), недоступность popup — тост
// (действие НЕ выполнено, надо обновить Telegram).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Card } from "@/ui/Card";

const { mockNativeConfirm, mockIsAvailable, toastShow, mutateBooking } =
  vi.hoisted(() => ({
    mockNativeConfirm: vi.fn(),
    mockIsAvailable: vi.fn(),
    toastShow: vi.fn(),
    mutateBooking: vi.fn(),
  }));

vi.mock("@/components/Profile/UserProfileProvider", () => ({
  useOpenUserProfile: () => vi.fn(),
}));

vi.mock("@/utils/telegram-adapter", () => ({
  nativeConfirm: (...args: unknown[]) => mockNativeConfirm(...args),
  isNativeConfirmAvailable: (...args: unknown[]) => mockIsAvailable(...args),
  isTelegramMockEnv: () => false,
}));

const bookings = [
  {
    id: "b-1",
    seat: 2,
    status: "pending",
    comment: null,
    passenger: {
      id: "p-7",
      name: "Мария",
      avatar: "https://cdn.example.com/m.png",
      rating: 4.8,
      reviewsCount: 5,
      tripsCount: 9,
    },
    trip: { id: "t-1" },
  },
];

vi.mock("@/queries/useBookingsQuery", () => ({
  useDriverRequestsQuery: () => ({
    data: bookings,
    isLoading: false,
    error: null,
  }),
  useUpdateBookingStatusMutation: () => ({
    mutate: (
      vars: { id: string; status: string },
      opts?: { onSuccess?: () => void },
    ) => {
      mutateBooking(vars.id, vars.status);
      opts?.onSuccess?.();
    },
    isPending: false,
    variables: undefined,
    error: null,
  }),
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: toastShow }),
}));

const { DriverTripRequests } =
  await import("@/components/Trip/DriverTripRequests");

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderRequests() {
  return render(
    <AppRoot platform="base">
      <Card variant="flush" onClick={() => {}}>
        <DriverTripRequests tripId="t-1" />
      </Card>
    </AppRoot>,
  );
}

async function clickDecision(name: RegExp) {
  renderRequests();
  fireEvent.click(screen.getByRole("button", { name }));
  // Решение идёт через nativeConfirm → промис, поэтому ждём микротаск.
  await act(async () => {});
}

describe("DriverTripRequests: confirm без popup даёт видимый исход", () => {
  it("принять без popup: тост, действие НЕ выполнено, confirm не спрашиваем", async () => {
    mockIsAvailable.mockReturnValue(false);

    await clickDecision(/Принять заявку Мария/);

    expect(mockNativeConfirm).not.toHaveBeenCalled();
    expect(mutateBooking).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow.mock.calls[0]?.[0]).toMatchObject({
      text: expect.stringContaining("Не удалось запросить подтверждение"),
      assertive: true,
    });
  });

  it("отклонить без popup: тост, действие НЕ выполнено", async () => {
    mockIsAvailable.mockReturnValue(false);

    await clickDecision(/Отклонить заявку Мария/);

    expect(mockNativeConfirm).not.toHaveBeenCalled();
    expect(mutateBooking).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow.mock.calls[0]?.[0]).toMatchObject({
      assertive: true,
    });
  });

  it("popup доступен, пользователь отказался: тишина — ни действия, ни тоста", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockNativeConfirm.mockResolvedValue(false);

    await clickDecision(/Принять заявку Мария/);

    expect(mutateBooking).not.toHaveBeenCalled();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it("popup доступен, пользователь согласился: действие выполняется", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockNativeConfirm.mockResolvedValue(true);

    await clickDecision(/Принять заявку Мария/);

    expect(mutateBooking).toHaveBeenCalledWith("b-1", "confirmed");
  });
});
