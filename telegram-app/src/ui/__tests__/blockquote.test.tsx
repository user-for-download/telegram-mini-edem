// @vitest-environment jsdom
// Тесты фасада ui/Blockquote — как и у Card, в первую очередь ПРИМЕНЕНИЕ,
// а не текст правила: решает class-атрибут реального рендера.
//
// Смысл фасада — два общих правила для СВОБОДНОГО текста человека:
// `pre-wrap` (переносы не склеиваются) и тон полосы слева. Если фасад не
// донесёт свой класс до корня, кит нарисует серый блок и правила умрут.
//
// Рендер DOM, а не SSR-строка: кит оборачивает плашку ещё одним div
// (обёртка иконки), и разбор HTML регуляркой цеплял внешний узел вместо
// корня плашки. Здесь корня ищем по самому классу — устойчиво к обёрткам.
import { cleanup, render } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { afterEach, describe, expect, it } from "vitest";

import { Blockquote } from "@/ui/Blockquote";
import uiStyles from "@/ui/ui.module.css";

// RTL auto-cleanup в проекте выключен (globals не заданы) — убираем дерево
// руками, иначе разобранные узлы живут до конца файла.
afterEach(cleanup);

const quoteClass: string = uiStyles.quote as string;
if (quoteClass === undefined) {
  throw new Error(
    "ui.module.css: класс .quote отсутствует — правила переносов не применятся",
  );
}

/** Корень плашки — узел с нашим классом (их ровно один по контракту). */
function rootOf(container: HTMLElement): HTMLElement {
  const node = container.querySelector(`.${quoteClass}`);
  if (node === null) throw new Error("корень плашки не найден в DOM");
  return node as HTMLElement;
}

function renderQuote(node: React.ReactNode): HTMLElement {
  const { container } = render(<AppRoot platform="base">{node}</AppRoot>);
  return container;
}

describe("ui/Blockquote: класс плашки реально попадает в DOM", () => {
  it("styles.quote применён без className потребителя", () => {
    // Ключевой случай: потребитель ничего не передаёт, а правило должно
    // работать всё равно (доктрина «фасад всегда несёт свой класс»).
    const container = renderQuote(<Blockquote>текст</Blockquote>);
    expect(container.querySelectorAll(`.${quoteClass}`).length).toBe(1);
  });

  it("styles.quote НЕ продублирован на корне", () => {
    const container = renderQuote(<Blockquote>текст</Blockquote>);
    const root = rootOf(container);
    const occurrences = Array.from(root.classList).filter(
      (c) => c === quoteClass,
    ).length;
    expect(occurrences).toBe(1);
  });

  it("className потребителя дописывается, а не затирает styles.quote", () => {
    const container = renderQuote(
      <Blockquote className="foo">текст</Blockquote>,
    );
    const root = rootOf(container);
    expect(root.classList.contains("foo")).toBe(true);
    expect(root.classList.contains(quoteClass)).toBe(true);
  });
});

describe("ui/Blockquote: тон полосы по смыслу", () => {
  it("без тона data-tone не выставлен — китовая синяя полоса по умолчанию", () => {
    const container = renderQuote(<Blockquote>текст</Blockquote>);
    expect(rootOf(container).dataset.tone).toBeUndefined();
  });

  it.each(["info", "success", "danger", "warning"] as const)(
    "tone=%s доезжает до data-tone на корне",
    (tone) => {
      const container = renderQuote(<Blockquote tone={tone}>текст</Blockquote>);
      expect(rootOf(container).dataset.tone).toBe(tone);
    },
  );
});

describe("ui/Blockquote: содержимое не оборачивается китным Subheadline", () => {
  it("внутренний Subheadline кита не появляется", () => {
    // `type="other"`: иначе кит обернул бы содержимое в Subheadline и
    // навязал кегль всем потомкам, включая вложенную разметку.
    // Хэш класса взят из китовых dist (Subheadline внутри Blockquote,
    // type="text"), версия 2.1.13 закреплена kitContract.test.tsx.
    const container = renderQuote(<Blockquote>текст</Blockquote>);
    expect(container.innerHTML).not.toContain("tgui-16ed20e7a6e2daa0");
  });

  it("переносы строк внутри сохранены как есть", () => {
    // JS-строка, а не текст JSX: в тексте JSX `\n` остаётся двумя
    // символами, и проверка прошла бы вхолостую.
    const container = renderQuote(<Blockquote>{"строка 1\nстрока 2"}</Blockquote>);
    expect(rootOf(container).textContent).toContain("строка 1\nстрока 2");
  });
});
