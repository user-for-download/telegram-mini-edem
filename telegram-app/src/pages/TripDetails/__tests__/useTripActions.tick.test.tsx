// @vitest-environment jsdom
// Регрессия (аудит 2026-10-05): useTripActions брал снимок Date.now() на
// маунте и больше его не двигал. canCompleteTrip — чисто клиентский гейт
// (серверная защита TRIP_IN_PAST есть только у canBook), поэтому водитель,
// открывший поездку ДО departureAt и оставивший страницу открытой, не мог
// завершить поездку до перезагрузки — кнопка оставалась задизейбленной, а
// подсказка «Завершение станет доступно после отправления» становилась ложью.
// Тот же замороженный снимок глушил и пассажирское сообщение об уехавшей
// поездке.
//
// SSR-файл tripDetailsPage.test.tsx это увидеть не может: там эффекты не
// выполняются. Здесь DOM + fake timers, поэтому границу отправления можно
// перешагнуть настоящим таймером.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: {
    notificationOccurred: { ifAvailable: vi.fn() },
    impactOccurred: { ifAvailable: vi.fn() },
    selectionChanged: { ifAvailable: vi.fn() },
  },
  miniApp: { ready: { ifAvailable: vi.fn() } },
  shareURL: { isAvailable: () => false, ifAvailable: vi.fn() },
}));

import { ToastProvider } from "@/components/Toast/ToastProvider";
import { useAuthStore } from "@/store/useAuthStore";
import { useTripActions } from "@/pages/TripDetails/useTripActions";
import type { Trip } from "@edem/contracts";

const DRIVER_ID = "11111111-1111-1111-1111-111111111111";

function makeTrip(departureAt: string): Trip {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    driver: { id: DRIVER_ID, name: "Водитель" },
    fromCity: "Вологда",
    toCity: "Череповец",
    departureAt,
    status: "active",
    seatsTotal: 3,
    seatsAvailable: 2,
    price: 500,
    durationMinutes: 120,
    time: "10:00",
    bookedSeats: [],
  } as unknown as Trip;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Фейковые таймеры мокают и Date — «сейчас» ходит вместе с ними.
  vi.useFakeTimers();
  useAuthStore.setState({
    user: { id: DRIVER_ID } as never,
    session: null,
    status: "authenticated",
  });
});

afterEach(() => {
  // cleanup первым: размонтировать дерево надо под тем же фейковым таймером,
  // под которым оно смонтировано. Без него пять renderHook-деревьев доживают
  // до конца файла — у каждого свой window.setTimeout на границу отправления
  // и подписка на модульный useAuthStore, который перезаписывает beforeEach
  // каждого следующего теста.
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useTripActions: граница отправления наступает, пока страница открыта", () => {
  it("до departureAt завершение недоступно, после — доступно без ремоунта", () => {
    const departureAt = new Date(Date.now() + 60_000).toISOString();
    const { result } = renderHook(() => useTripActions(makeTrip(departureAt)), {
      wrapper,
    });

    expect(result.current.departed).toBe(false);
    expect(result.current.canCompleteTrip).toBe(false);

    // Рермоунта НЕТ — страница всё та же, открытая в Telegram. Переход
    // обязан произойти сам, по таймеру хука.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.departed).toBe(true);
    expect(result.current.canCompleteTrip).toBe(true);
  });

  it("после границы таймер больше не перезапускается (нет тика в пустоту)", () => {
    const departureAt = new Date(Date.now() + 30_000).toISOString();
    const { result } = renderHook(() => useTripActions(makeTrip(departureAt)), {
      wrapper,
    });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.canCompleteTrip).toBe(true);
    // Второй проход ничего не меняет: canCompleteTrip уже true.
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(result.current.canCompleteTrip).toBe(true);
    expect(result.current.departed).toBe(true);
  });

  it("поездка в прошлом на маунте: сразу доступна, таймер не ставится", () => {
    const departureAt = new Date(Date.now() - 60_000).toISOString();
    const { result } = renderHook(
      ({ trip }: { trip: Trip }) => useTripActions(trip),
      { wrapper, initialProps: { trip: makeTrip(departureAt) } },
    );

    expect(result.current.departed).toBe(true);
    expect(result.current.canCompleteTrip).toBe(true);
  });

  it("отмена поездки закрывает завершение независимо от времени", () => {
    const departureAt = new Date(Date.now() - 60_000).toISOString();
    const trip = { ...makeTrip(departureAt), status: "cancelled" } as Trip;
    const { result } = renderHook(() => useTripActions(trip), { wrapper });

    expect(result.current.canCompleteTrip).toBe(false);
  });

  it("очень далёкое отправление не переполняет setTimeout", () => {
    // Через ~300 дней: прямой таймер на такой срок переполнился бы
    // (int32) и сработал бы сразу — граница наступила бы мгновенно.
    const far = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString();
    const { result } = renderHook(() => useTripActions(makeTrip(far)), {
      wrapper,
    });

    expect(result.current.departed).toBe(false);
    expect(result.current.canCompleteTrip).toBe(false);
  });
});
