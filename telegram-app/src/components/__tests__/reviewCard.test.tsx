// @vitest-environment jsdom
// ReviewCard: шапка (аватар + имя) открывает шторку профиля автора.
//
// Отдельно проверяем, что вложенный интерактив не появился: кнопка
// занимает блок head, а не оборачивает всю карточку. Сам отзыв кликабельным
// не является — оборачивать Card в кнопку было бы вложенной разметкой без
// смысла.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

const here = dirname(fileURLToPath(import.meta.url));

const openUserProfile = vi.fn();
vi.mock("@/components/Profile/UserProfileProvider", () => ({
  useOpenUserProfile: () => openUserProfile,
}));

const { ReviewCard } = await import("@/components/ReviewCard/ReviewCard");
import type { Review } from "@edem/contracts";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Полный Review по контракту, а не `as never`: фикстура обязана дрейфовать
// вместе с контрактом — иначе рассинхрон с бэкендом тест не заметит
// (MINOR аудита).
const REVIEW: Review = {
  id: "r-1",
  targetRole: "driver",
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
};

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

  it("заголовок — роль автора, а не дубль имени", () => {
    // Отзыв — о водителе (targetRole: driver), значит автор — пассажир.
    // Заголовок шторки называет роль: имя уже показывает hero ниже,
    // заголовок-именем давал бы «ФИО → ФИО».
    renderCard();
    fireEvent.click(screen.getByText("Анна"));

    expect(openUserProfile.mock.calls[0]?.[0]?.title).toBe("Пассажир");
  });

  it("текст и маршрут отзыва остались на месте", () => {
    renderCard();
    expect(screen.getByText("Всё отлично, поехал бы снова")).toBeTruthy();
    // Маршрут — без подписи «Маршрут: »: 66px надписи стоили ровно того,
    // что «Вологда → Череповец» (205px) в 204px доступных обрезался на
    // последней букве. Формат тот же, что у строки уведомлений, — адрес
    // сам говорит, что он адрес (реестр #57).
    expect(screen.queryByText(/Маршрут:/)).toBeNull();
    expect(screen.getByText("Вологда → Череповец")).toBeTruthy();
  });
});

// Маршрут — до двух строк, а не одна обрезанная: длинный адрес
// («Ленинградская область → Санкт-Петербург») переносится, короткий
// остаётся строкой. Статус справа не сжимается, поэтому ширину делит
// маршрут (реестр #57).
describe("подвал карточки: маршрут переносится", () => {
  it("CSS: маршрут клампится в две строки", () => {
    const css = readFileSync(
      join(here, "..", "ReviewCard", "ReviewCard.module.css"),
      "utf8",
    );
    const rule = css.match(/\.route\s*\{([^}]*)\}/)?.[1];
    expect(rule, "правило маршрута пропало").toBeTruthy();
    expect(rule).toContain("-webkit-line-clamp: 2");
    // Однострочный `nowrap` — ровно то, что обрезало «Череповец».
    expect(rule).not.toContain("white-space: nowrap");
  });
});
