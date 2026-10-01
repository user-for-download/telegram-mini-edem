// Тесты фасада ui/Card — в первую очередь ПРИМЕНЕНИЕ, а не текст правила.
//
// История файла (2026-10-01): поверхность карточки была объявлена в
// ui.module.css под селектором `.card.card`, но ui/Card добавлял в className
// только `cardDefault`/`cardFlush`. Селектор с двумя одинаковыми классами
// требует, чтобы класс стоял в атрибуте ДВАЖДЫ, поэтому правило не
// матчилось НИГДЕ: карточки рендерились с дефолтами кита (фон-литерал
// tertiary_bg_color, radius 20, тяжёлая тень) и шириной по контенту.
// Текстовые проверки в layoutCss.test.ts были зелёными — они читали CSS.
//
// Поэтому здесь проверяем class-атрибут реального рендера: именно он
// определяет, применится ли правило.
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

  it("styles.card НЕ продублирован: селектор .card.card не вернуть", () => {
    // Регрессия-фикса: если бы мы «починили» поверхность удвоением класса в
    // className, вернулся бы старый нерабочий паттерн. Одно вхождение —
    // правильное состояние при селекторе `.card`.
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
