// @vitest-environment jsdom
// ReviewCard: шапка (аватар + имя) открывает шторку профиля автора.
//
// Отдельно проверяем, что вложенный интерактив не появился: кнопка
// занимает блок head, а не оборачивает всю карточку. Сам отзыв кликабельным
// не является — оборачивать Card в кнопку было бы вложенной разметкой без
// смысла.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

const openUserProfile = vi.fn();
vi.mock("@/components/Profile/UserProfileProvider", () => ({
  useOpenUserProfile: () => openUserProfile,
}));

const { ReviewCard } = await import("@/components/ReviewCard/ReviewCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const REVIEW = {
  id: "r-1",
  rating: 5,
  text: "Всё отлично, поехал бы снова",
  status: "published",
  date: "12 сентября",
  tripRoute: "Вологда → Череповец",
  author: {
    id: "u-42",
    name: "Анна",
    avatar: "https://cdn.example.com/a.png",
    rating: 4.7,
    reviewsCount: 3,
    tripsCount: 12,
  },
} as never;

function renderCard() {
  return render(
    <AppRoot platform="base">
      <ReviewCard review={REVIEW} />
    </AppRoot>,
  );
}

describe("ReviewCard: профиль автора", () => {
  it("тап по имени автора открывает шторку с его id", () => {
    renderCard();
    fireEvent.click(screen.getByText("Анна"));

    expect(openUserProfile).toHaveBeenCalledTimes(1);
    expect(openUserProfile.mock.calls[0]?.[0]?.id).toBe("u-42");
  });

  it("автор передан в initial, чтобы карточка рисовалась сразу", () => {
    renderCard();
    fireEvent.click(screen.getByText("Анна"));

    const target = openUserProfile.mock.calls[0]?.[0];
    expect(target?.initial?.name).toBe("Анна");
    expect(target?.initial?.tripsCount).toBe(12);
  });

  it("текст и маршрут отзыва остались на месте", () => {
    renderCard();
    expect(screen.getByText("Всё отлично, поехал бы снова")).toBeTruthy();
    // Маршрут отрисован как «Маршрут: <значение>» двумя узлами, поэтому
    // сверяем по подписи, а не по самому значению.
    expect(screen.getByText(/Маршрут:/)).toBeTruthy();
    expect(screen.getByText(/Череповец/)).toBeTruthy();
  });
});
