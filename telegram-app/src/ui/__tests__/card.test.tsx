// Тесты фасада ui/Card — в первую очередь ПРИМЕНЕНИЕ, а не текст правила.
//
// Текстовые проверки читают CSS, а решает class-атрибут реального рендера:
// именно он определяет, применится ли правило. Поэтому проверяем его здесь.
import { AppRoot } from "@telegram-apps/telegram-ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Card } from "@/ui/Card";
import uiStyles from "@/ui/ui.module.css";

const render = (node: React.ReactNode): string =>
  renderToString(<AppRoot platform="base">{node}</AppRoot>);

/** Классы одного узла (первый class="..." — корень article). */
const classesOf = (html: string): string[] => {
  const m = html.match(/<article[^>]*class="([^"]*)"/);
  return m?.[1]?.split(/\s+/).filter(Boolean) ?? [];
};

/**
 * Хэш класса поверхности. Модули типизированы как `string | undefined`,
 * поэтому здесь сужаем тип: если бы ui.module.css потерял `.card`, падать
 * должно на этой строке, а не молча сравнивать с undefined.
 */
const cardClass: string = uiStyles.card as string;
if (cardClass === undefined) {
  throw new Error("ui.module.css: класс .card отсутствует — surface Card не применится");
}

describe("ui/Card: класс поверхности реально попадает в DOM", () => {
  it("styles.card применён — иначе правило .card не сматчится", () => {
    const classes = classesOf(render(<Card>тело</Card>));
    expect(classes).toContain(cardClass);
  });

  it("styles.card НЕ продублирован", () => {
    // Одно вхождение — правильное состояние при селекторе `.card`.
    const classes = classesOf(render(<Card>тело</Card>));
    const occurrences = classes.filter((c) => c === cardClass).length;
    expect(occurrences).toBe(1);
  });

  it("поверхность и паддинг variant сосуществуют на одном узле", () => {
    const classes = classesOf(render(<Card>тело</Card>));
    expect(classes).toContain(cardClass);
    expect(classes).toContain(uiStyles.cardDefault);
  });

  it("variant=flush меняет только паддинг, поверхность остаётся", () => {
    const classes = classesOf(render(<Card variant="flush">тело</Card>));
    expect(classes).toContain(cardClass);
    expect(classes).toContain(uiStyles.cardFlush);
    expect(classes).not.toContain(uiStyles.cardDefault);
  });

  it("className потребителя дописывается, а не затирает styles.card", () => {
    const classes = classesOf(render(<Card className="foo">тело</Card>));
    expect(classes).toContain(cardClass);
    expect(classes).toContain("foo");
  });

  it("поверхность приходит на НАТИВНЫЙ article кита (не на div-обёртку)", () => {
    const html = render(<Card>тело</Card>);
    expect(html).toContain("<article");
    // Наш класс обязан быть на article, а не на корне AppRoot-обёртке.
    expect(html).toMatch(new RegExp(`<article[^>]*${cardClass}`));
  });
});
