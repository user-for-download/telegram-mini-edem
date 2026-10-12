// @vitest-environment jsdom
// Регресс безопасности: интерактивы «открыть профиль пассажира» НЕ должны
// перехватывать решение по заявке.
//
// До появления шторки строка пассажира была пассивной, а кнопки −/+ были
// единственными действиями. Теперь у строки есть своё действие (открыть
// профиль), и оно стоит рядом с кнопками решения — легко получить сценарий,
// где тап по «профилю» подтверждает или отклоняет заявку.
//
// Провайдер подменён: тест проверяет, что КОМПОНЕНТ вызывает openUserProfile
// с id пассажира и гасит всплытие, не дёргая askAndAct.
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

const openUserProfile = vi.fn();
const cardClick = vi.fn();
vi.mock("@/components/Profile/UserProfileProvider", () => ({
  useOpenUserProfile: () => openUserProfile,
}));

const confirmBooking = vi.fn();
vi.mock("@/utils/telegram-adapter", () => ({
  nativeConfirm: () => Promise.resolve(true),
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
    mutate: (vars: {
      id: string;
      status: string;
      onSuccess?: () => void;
      onError?: () => void;
    }) => {
      confirmBooking(vars.id, vars.status);
      vars.onSuccess?.();
    },
    isPending: false,
    variables: undefined,
    error: null,
  }),
}));

vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

const { DriverTripRequests } =
  await import("@/components/Trip/DriverTripRequests");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRequests() {
  // Родитель с onClick — это Card карточки поездки (TripStandardCard):
  // в реальности DriverTripRequests приходит в неё как personOverride, и
  // любой тап без stopPropagation всплыл бы в её обработчик и открыл
  // детали поездки поверх шторки профиля. Настоящий ui/Card, а не див:
  // кликабельность карточки задана компонентом кита, а не сырым тегом.
  return render(
    <AppRoot platform="base">
      <Card variant="flush" onClick={cardClick}>
        <DriverTripRequests tripId="t-1" />
      </Card>
    </AppRoot>,
  );
}

describe("DriverTripRequests: профиль пассажира", () => {
  it("тап по имени открывает профиль с id пассажира", () => {
    renderRequests();
    fireEvent.click(screen.getByText("Мария"));

    expect(openUserProfile).toHaveBeenCalledTimes(1);
    expect(openUserProfile.mock.calls[0]?.[0]?.id).toBe("p-7");
  });

  it("открытие профиля НЕ принимает заявку и НЕ всплывает в карточку", () => {
    renderRequests();
    fireEvent.click(screen.getByText("Мария"));

    // Решение по заявке живёт только на кнопках −/+. Тап по имени гасит
    // всплытие и не должен дойти до обработчика карточки поездки.
    expect(confirmBooking).not.toHaveBeenCalled();
    expect(cardClick).not.toHaveBeenCalled();
  });

  it("кнопки решения остались и вызывают свой обработчик", async () => {
    renderRequests();
    fireEvent.click(
      screen.getByRole("button", { name: /Принять заявку Мария/ }),
    );
    // Решение идёт через nativeConfirm → промис, поэтому ждём микротаск.
    await act(async () => {});

    expect(confirmBooking).toHaveBeenCalledWith("b-1", "confirmed");
    // И профиль при этом не открывается.
    expect(openUserProfile).not.toHaveBeenCalled();
  });
});
