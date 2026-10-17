// @vitest-environment jsdom
// F19: завершение и отмена поездки водителем ОБЪЯВЛЯЮТСЯ.
//
// Было: `onConfirm={() => completeTrip.mutate(tripId)}` — у мутации был только
// `onSuccess: invalidate`. Единственная обратная связь — молчаливый
// `<Caption>`, без role. После успеха кнопки исчезали из DOM, и ни
// скринридер, ни клавиатурный пользователь не узнавали, что действие прошло.
//
// Проверяем DOM-структуру, а не пропсы: роль обязана стоять на узле, который
// НЕСЁТ ТЕКСТ. Роль на пустой обёртке — это ровно тот баг, что закреплён в
// MEMORY.md:485 и запинен ToastProvider.test.tsx.
//
// Отдельно закреплено разделение успеха и неудачи (BookingPanel — образец):
// успех объявляется вежливо (role="status", aria-live="polite"), неудача —
// настойчиво (Notice tone="danger" → role="alert" по умолчанию).

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MemoryRouter } from "react-router-dom";

const {
  mockUseTripBookings,
  mockUseDriverRequests,
  mockUseCancelTrip,
  mockUseCompleteTrip,
} = vi.hoisted(() => ({
  mockUseTripBookings: vi.fn(),
  mockUseDriverRequests: vi.fn(),
  mockUseCancelTrip: vi.fn(),
  mockUseCompleteTrip: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: mockUseTripBookings,
  useDriverRequestsQuery: mockUseDriverRequests,
  useCancelBookingMutation: vi.fn(),
  // Панель показывает список заявок (TripPassengers), значит мутация нужна
  // с полным контрактом, а не голым vi.fn().
  useUpdateBookingStatusMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  }),
  useMyBookingsQuery: vi.fn(),
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useCancelTripMutation: mockUseCancelTrip,
  useCompleteTripMutation: mockUseCompleteTrip,
}));

import { DriverPanel } from "@/pages/TripDetails/DriverPanel";
import { ToastProvider } from "@/components/Toast/ToastProvider";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Мутация-заглушка: повторяет контракт TanStack — onSuccess вызывается ПОСЛЕ
 *  mutationFn, поэтому асинхронно (иначе тест проверял бы синхронный порядок
 *  React, а не объявление исхода). */
function mutationSpy(fail: Error | null = null) {
  const mutate = vi.fn(async (...args: unknown[]) => {
    const options = args[1] as { onSuccess?: () => void; onError?: () => void };
    if (fail) options.onError?.();
    else options.onSuccess?.();
  });
  return { mutate, isPending: false, error: fail, variables: undefined };
}

function makeTrip() {
  return {
    id: "t-1",
    fromCity: "Москва",
    toCity: "Тула",
    date: "2030-06-01",
    time: "09:00",
    departureAt: "2030-06-01T09:00:00.000Z",
    durationMinutes: 120,
    distanceKm: 180,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 1,
    pendingRequestsCount: 0,
    driver: { id: "u-me", name: "Я", rating: 5, reviewsCount: 1, avatar: null },
    tags: [],
    comment: null,
    status: "active",
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockUseDriverRequests.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseTripBookings.mockReturnValue({
    data: { pages: [{ items: [] }], pageParams: [undefined] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function mount(options: { departed?: boolean; status?: string } = {}) {
  const { departed = true, status = "active" } = options;
  await act(async () => {
    root.render(
      <AppRoot platform="base">
        <MemoryRouter initialEntries={["/trips/t-1"]}>
          <ToastProvider>
            <DriverPanel
              tripId="t-1"
              status={status}
              isActive={status === "active"}
              canCompleteTrip={departed}
              departed={departed}
              editing={false}
              onToggleEdit={vi.fn()}
              trip={makeTrip() as never}
            />
          </ToastProvider>
        </MemoryRouter>
      </AppRoot>,
    );
  });
}

/** Клик по триггеру ConfirmPopup → шторка подтверждения → кнопка подтверждения. */
async function confirm(label: string, confirmLabel: string) {
  const trigger = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.trim() === label,
  );
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  // В шторке кнопка подтверждения идёт ПОСЛЕ одноимённого триггера в DOM
  // (портал), поэтому берём последнюю подходящую.
  const matches = [...document.body.querySelectorAll("button")].filter(
    (b) => b.textContent?.trim() === confirmLabel,
  );
  const confirmButton = matches[matches.length - 1];
  expect(confirmButton).toBeTruthy();
  await act(async () => {
    confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Узлы-носители объявления: с текстом и без вложенных live-узлов. */
const liveNodes = () =>
  [
    ...container.querySelectorAll('[role="status"], [role="alert"]'),
  ].filter((node) => (node.textContent ?? "").trim().length > 0);

describe("DriverPanel: исход завершения/отмены объявляется", () => {
  it("завершение: role=status с НЕПУСТЫМ текстом появляется после мутации", async () => {
    const complete = mutationSpy();
    mockUseCompleteTrip.mockReturnValue(complete);
    mockUseCancelTrip.mockReturnValue(mutationSpy());

    await mount();
    // ДО действия объявления нет — иначе тест прошёл бы и на сломанном коде.
    expect(liveNodes()).toHaveLength(0);

    await confirm("Завершить поездку", "Завершить");

    expect(complete.mutate).toHaveBeenCalledWith(
      "t-1",
      expect.anything(),
    );

    const status = liveNodes().filter(
      (n) => n.getAttribute("role") === "status",
    );
    expect(status.length).toBeGreaterThan(0);
    // Роль на текст-несущем узле, а не на пустом соседе (суть MEMORY.md:485).
    const text = status.map((n) => n.textContent ?? "").join(" ");
    expect(text).toContain("Поездка завершена");
    expect(text.trim()).not.toBe("");
  });

  it("отмена: role=status с НЕПУСТЫМ текстом появляется после мутации", async () => {
    const cancel = mutationSpy();
    mockUseCancelTrip.mockReturnValue(cancel);
    mockUseCompleteTrip.mockReturnValue(mutationSpy());

    // Не уехавшая поездка: иначе кнопки отмены на экране нет.
    await mount({ departed: false });
    expect(liveNodes()).toHaveLength(0);

    await confirm("Отменить поездку", "Отменить поездку");

    expect(cancel.mutate).toHaveBeenCalledWith("t-1", expect.anything());

    const status = liveNodes().filter(
      (n) => n.getAttribute("role") === "status",
    );
    expect(status.length).toBeGreaterThan(0);
    expect(status.map((n) => n.textContent ?? "").join(" ")).toContain(
      "Поездка отменена",
    );
  });

  it("успех объявляется ВЕЖЛИВО (polite), а не как alert", async () => {
    const complete = mutationSpy();
    mockUseCompleteTrip.mockReturnValue(complete);
    mockUseCancelTrip.mockReturnValue(mutationSpy());

    await mount();
    await confirm("Завершить поездку", "Завершить");

    const status = liveNodes().filter(
      (n) => n.getAttribute("role") === "status",
    );
    expect(status.length).toBeGreaterThan(0);
    // role="alert" на успехе — враньё: он перебил бы текущий вывод скринридера.
    expect(
      liveNodes().filter((n) => n.getAttribute("role") === "alert"),
    ).toHaveLength(0);
  });

  it("неудача объявляется НАСТОЙЧИВО: role=alert с НЕПУСТЫМ текстом", async () => {
    // BookingPanel — образец разделения: успех status, неудача alert.
    // Notice tone="danger" даёт role="alert" по умолчанию (ui/Notice.tsx).
    mockUseCancelTrip.mockReturnValue(mutationSpy(new Error("boom")));
    mockUseCompleteTrip.mockReturnValue(mutationSpy(new Error("boom")));

    await mount();

    const alerts = liveNodes().filter(
      (n) => n.getAttribute("role") === "alert",
    );
    expect(alerts.length).toBeGreaterThan(0);
    expect((alerts[0]?.textContent ?? "").trim()).not.toBe("");
  });

  it("постоянная строка исхода сама несёт role=status на узле с текстом", async () => {
    // Тост живёт 3,2 с; запись исхода остаётся на экране — значит роль
    // должна стоять на самом <Caption>, а не на обёртке секции.
    await mount({ departed: true, status: "completed" });

    const caption = [...container.querySelectorAll('[role="status"]')].find(
      (n) => n.textContent?.includes("Поездка завершена"),
    );
    expect(caption).toBeTruthy();
    expect((caption?.textContent ?? "").trim()).not.toBe("");
    expect(caption?.textContent).toContain("пассажиры могут оставить отзыв");
  });
});
