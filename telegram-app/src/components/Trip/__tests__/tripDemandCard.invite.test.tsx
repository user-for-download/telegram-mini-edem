// @vitest-environment jsdom
// Аффорданс приглашения в карточке спроса (Слой 1b): водитель жмёт
// «Пригласить» — уходит мутация с id заявки и своей поездки, успех и 409
// показываются тостом (ошибка — через общий bookingErrorMessage).
//
// Паттерн — jsdom + fireEvent, как у rideRequestCreateForm.submit.test.tsx:
// SSR не умеет кликать, а именно клик тут и проверяется.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ApiError } from "@/api/client";
import type { RideRequestInvite } from "@/api/rideRequests.api";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import type { RideRequest } from "@edem/contracts";

const {
  mockUseTripDemand,
  mockUseInvite,
  mockMutate,
  mockToastShow,
} = vi.hoisted(() => ({
  mockUseTripDemand: vi.fn(),
  mockUseInvite: vi.fn(),
  mockMutate: vi.fn(),
  mockToastShow: vi.fn(),
}));

vi.mock("@/queries/useRideRequestsQuery", () => ({
  useTripDemandQuery: mockUseTripDemand,
  useInviteRideRequestMutation: mockUseInvite,
}));

vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: mockToastShow }) };
});

import { TripDemandCard } from "@/components/Trip/TripDemandCard";
import { inviteToastText } from "@/components/Trip/TripDemandRow";

interface InviteOptions {
  onSuccess?: (result: RideRequestInvite) => void;
  onError?: (error: unknown) => void;
}

/** Мутация, которая отвечает тем, чем ответил бы сервер. */
function respondWith(
  result?: RideRequestInvite,
  error?: unknown,
): (variables: unknown, options?: InviteOptions) => void {
  return (_variables, options) => {
    if (error !== undefined) options?.onError?.(error);
    if (result !== undefined) options?.onSuccess?.(result);
  };
}

const DELIVERED: RideRequestInvite = {
  invited: true,
  duplicate: false,
  notificationId: "n-1",
};

function rideRequest(overrides: Partial<RideRequest> = {}): RideRequest {
  return {
    id: "r-1",
    fromCity: { id: "c-1", name: "Вологда" },
    toCity: { id: "c-2", name: "Сокол" },
    earliestAt: "2030-06-02T05:00:00.000Z",
    latestAt: "2030-06-02T12:00:00.000Z",
    seats: 1,
    status: "active",
    expiresAt: "2030-06-01T05:00:00.000Z",
    createdAt: "2030-05-01T05:00:00.000Z",
    updatedAt: "2030-05-01T05:00:00.000Z",
    ...overrides,
  };
}

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderCard(seatsAvailable?: number): void {
  render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/bookings?segment=driver"]}>
        <TripDemandCard tripId="t-1" seatsAvailable={seatsAvailable} />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseTripDemand.mockReturnValue(queryState({ data: [rideRequest()] }));
  mockUseInvite.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    error: null,
  });
  mockMutate.mockImplementation(respondWith(DELIVERED));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("карточка спроса: приглашение", () => {
  it("уходит мутация с id заявки и своей поездки", () => {
    // Arrange
    renderCard(2);

    // Act
    fireEvent.click(
      screen.getByRole("button", { name: /Пригласить попутчика/ }),
    );

    // Assert
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      requestId: "r-1",
      tripId: "t-1",
    });
  });

  it("приглашает именно ту заявку, у которой нажали кнопку", () => {
    // Arrange: у каждой строки своя кнопка, значит и свой id в мутации.
    mockUseTripDemand.mockReturnValue(
      queryState({
        data: [
          rideRequest({ id: "r-1", earliestAt: "2030-06-02T05:00:00.000Z" }),
          rideRequest({ id: "r-2", earliestAt: "2030-06-02T09:00:00.000Z" }),
        ],
      }),
    );
    renderCard(2);

    // Act: вторая кнопка — вторая заявка (окно с 12:00 МСК против 08:00).
    fireEvent.click(
      screen.getAllByRole("button", { name: /Пригласить попутчика/ })[1]!,
    );

    // Assert
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      requestId: "r-2",
      tripId: "t-1",
    });
  });

  it("успех — тост «Приглашение отправлено»", () => {
    // Arrange
    renderCard(2);

    // Act
    fireEvent.click(screen.getByRole("button", { name: /Пригласить/ }));

    // Assert
    expect(mockToastShow).toHaveBeenCalledWith({
      text: "Приглашение отправлено",
    });
  });

  it("409 без мест — текст из bookingErrorMessage, не сырой с бэка", () => {
    // Arrange: бэк отдаёт CONFLICT (нет мест) — общий словарь кодов.
    const conflict = new ApiError("Not enough available seats", "CONFLICT", 409);
    mockMutate.mockImplementation(respondWith(undefined, conflict));
    renderCard(2);

    // Act
    fireEvent.click(screen.getByRole("button", { name: /Пригласить/ }));

    // Assert
    expect(mockToastShow).toHaveBeenCalledWith({
      text: bookingErrorMessage(conflict),
      assertive: true,
    });
    expect(mockToastShow).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: "Not enough available seats" }),
    );
  });
});

describe("карточка спроса: нет свободных мест", () => {
  it("seatsAvailable = 0 — кнопки приглашения нет вовсе", () => {
    // Arrange
    renderCard(0);

    // Act / Assert
    expect(
      screen.queryByRole("button", { name: /Пригласить/ }),
    ).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("seatsAvailable неизвестно — кнопка есть, окончательно решает сервер", () => {
    // Arrange: проп не передан, мест могло и не кончиться.
    renderCard();

    // Act / Assert
    expect(screen.getByRole("button", { name: /Пригласить/ })).toBeTruthy();
  });
});

describe("карточка спроса: разметка строки", () => {
  it("приглашение — сосед строки, а не кнопка внутри кнопки", () => {
    // Arrange: MenuRow рендерит нативный <button>; вложенная кнопка — невалидный
    // HTML и сломанный фокус, поэтому действие стоит рядом.
    renderCard(2);

    // Act
    const row = screen.getByRole("button", { name: /Заявка попутчика/ });

    // Assert
    expect(row.querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Пригласить/ })).toBeTruthy();
  });
});

describe("inviteToastText: три исхода одного нажатия (чистая функция)", () => {
  it("повтор приглашения не выдаётся за новое уведомление", () => {
    expect(
      inviteToastText({ invited: true, duplicate: true, notificationId: "n-1" }),
    ).toBe("Приглашение уже отправлено");
  });

  it("недоставленное уведомление не выдаётся за доставленное", () => {
    expect(
      inviteToastText({
        invited: true,
        duplicate: false,
        notificationId: null,
      }),
    ).toBe("Приглашение записано, но уведомление не доставлено");
  });

  it("обычный успех — короткий текст", () => {
    expect(inviteToastText(DELIVERED)).toBe("Приглашение отправлено");
  });
});
