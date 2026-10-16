// @vitest-environment jsdom
// a11y-контракт ReviewCard (F2, аудит 2026-10-15).
//
// Дефект: `aria-label` висел на голом <div>. Такой узел — role=generic,
// а generic НЕ exposes aria-label: подпись молча терялась, и оценка
// отзыва целиком выпадала из дерева доступности (MEMORY.md §18:
// «role/live-region must sit on the element carrying the TEXT» — здесь
// текста нет вовсе, поэтому нужна роль, которая имя экспонирует).
//
// Контракт, который здесь закреплён:
//  1. блок оценки — `role="img"` с именем, содержащим ЧИСЛО («Оценка 5 из 5»);
//  2. имя реально доступно по роли, а не живёт в атрибуте (getByRole с
//     вычисленным accessible name — иначе тест проверял бы проп, а не DOM);
//  3. каждая звезда декоративна и не засоряет имя.
//
// Тот же паттерн — components/Trip/AvatarStack.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Review } from "@edem/contracts";

const openUserProfile = vi.fn();
vi.mock("@/components/Profile/UserProfileProvider", () => ({
  useOpenUserProfile: () => openUserProfile,
}));

const { ReviewCard } = await import("@/components/ReviewCard/ReviewCard");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Полный Review по контракту, а не `as never`: фикстура обязана дрейфовать
// вместе с контрактом — иначе рассинхрон с бэкендом тест не заметит.
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

function renderCard(review: Review = REVIEW) {
  return render(
    <AppRoot platform="base">
      <ReviewCard review={review} />
    </AppRoot>,
  );
}

describe("ReviewCard: оценка доступна скринридеру", () => {
  it("блок оценки отдаёт роль img с именем, в котором есть число", () => {
    renderCard();

    // Ключевая проверка: имя ВЫЧИСЛЕНО из дерева доступности по роли.
    // До фикса здесь бросалось «Unable to find role img» — generic
    // подпись не экспонирует, поэтому находки не было вовсе.
    const rating = screen.getByRole("img", { name: /Оценка 5 из 5/ });

    expect(rating.getAttribute("role")).toBe("img");
    expect(rating.getAttribute("aria-label")).toBe("Оценка 5 из 5");
  });

  it("имя приходит из aria-label: в тексте верстки числа нет", () => {
    // Внутри блока только SVG-звезды, поэтому число в имени обязано
    // приходить из aria-label. Если бы имя вычислялось по содержимому,
    // оно было бы пустым — а озвучка молчала бы.
    renderCard();

    const rating = screen.getByRole("img", { name: /5/ });

    expect(rating.textContent).toBe("");
    expect(rating.getAttribute("aria-label")).toBe("Оценка 5 из 5");
    // Имя именно вычислено по роли: запрос с ЧУЖИМ числом не находит
    // ничего — значит это не тупое совпадение подстроки в разметке.
    expect(
      screen.queryByRole("img", { name: "Оценка 4 из 5" }),
    ).toBeNull();
  });

  it("оценка ниже максимума называется своей цифрой, а не «из 5»", () => {
    renderCard({ ...REVIEW, rating: 3 });

    expect(screen.getByRole("img", { name: "Оценка 3 из 5" })).toBeTruthy();
  });

  it("каждая звезда декоративна и не засоряет доступное имя", () => {
    renderCard();

    const rating = screen.getByRole("img", { name: /Оценка 5 из 5/ });
    const stars = rating.querySelectorAll("svg");

    expect(stars).toHaveLength(REVIEW.rating);
    for (const star of stars) {
      expect(star.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("число звёзд совпадает с оценкой", () => {
    renderCard({ ...REVIEW, rating: 4 });

    const rating = screen.getByRole("img", { name: "Оценка 4 из 5" });

    expect(rating.querySelectorAll("svg")).toHaveLength(4);
  });
});
