// Рендер-тесты ProfileHero — общий шапки для «себя» и «другого».
//
// Разница только в пропах: телефон и слот действия есть у своего
// профиля и отсутствуют у чужого. Раскладка общая, поэтому проверяем
// именно условные части и склонение рядом с прочерком рейтинга.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ProfileHero } from "@/components/Profile/ProfileHero";

function render(element: React.ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

const USER = {
  name: "Александр Иванов",
  avatar: "https://cdn.example.com/a.png",
  rating: 4.9,
  reviewsCount: 12,
  tripsCount: 34,
};

describe("ProfileHero", () => {
  it("имя, аватар и строка метрик — поездки · рейтинг · отзывы", () => {
    const html = render(<ProfileHero user={USER} />);
    expect(html).toContain("Александр Иванов");
    expect(html).toContain("https://cdn.example.com/a.png");
    expect(html).toContain("поездок: 34");
    expect(html).toContain("4.9");
    // Склонение для 12 — «отзывов».
    expect(html).toContain("12 отзывов");
  });

  it("склонение отзывов: 1 отзыв / 2 отзыва / 5 отзывов", () => {
    expect(
      render(<ProfileHero user={{ ...USER, reviewsCount: 1 }} />),
    ).toContain("1 отзыв");
    expect(
      render(<ProfileHero user={{ ...USER, reviewsCount: 2 }} />),
    ).toContain("2 отзыва");
    expect(
      render(<ProfileHero user={{ ...USER, reviewsCount: 5 }} />),
    ).toContain("5 отзывов");
  });

  it("без отзывов рейтинг — прочерк, и рядом стоит «0 отзывов»", () => {
    // RatingPill прячет 5.0 при reviewsCount === 0 (hasRating), так что
    // число рядом обязано быть согласовано, иначе «0 отзывов» читается
    // как ошибка подписи.
    const html = render(
      <ProfileHero user={{ ...USER, rating: 5, reviewsCount: 0 }} />,
    );
    expect(html).toContain("0 отзывов");
    expect(html).not.toContain("5.0");
  });

  it("телефон рисуется только когда передан (свой профиль)", () => {
    expect(
      render(<ProfileHero user={USER} phone="+7 900 123-45-67" />),
    ).toContain("+7 900 123-45-67");
    // У другого человека телефона нет — и шапка его не выдумывает.
    expect(render(<ProfileHero user={USER} />)).not.toContain("+7");
  });

  it("пустой телефон не рисует строку вовсе", () => {
    const html = render(<ProfileHero user={USER} phone={null} />);
    expect(html).not.toContain("+7");
  });

  it("слот действия рендерится там, где передан", () => {
    const html = render(
      <ProfileHero
        user={USER}
        action={<button type="button">Редактировать профиль</button>}
      />,
    );
    expect(html).toContain("Редактировать профиль");
  });

  it("щит верификации — только при isVerified", () => {
    expect(
      render(<ProfileHero user={{ ...USER, isVerified: true }} />),
    ).toContain("Верифицирован");
    expect(render(<ProfileHero user={USER} />)).not.toContain("Верифицирован");
  });

  it("без аватара — инициалы из имени", () => {
    const html = render(<ProfileHero user={{ ...USER, avatar: null }} />);
    expect(html).toContain("АЛ");
    expect(html).not.toContain("cdn.example.com");
  });
});
