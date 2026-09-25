// Тесты Notice (K2+K7) без @testing-library/react (не установлен):
// react-dom/server renderToString — паттерн
// telegram-app/src/components/__tests__/statusPill.test.tsx.
// Проверяется только обёртка (тэг ↔ variant, tone → role/data-атрибуты,
// className, текст); внутренности ui.module.css не тестируем, кроме
// регрессии K7 (banner без space-between — сырой текст модуля).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { Notice } from "@/ui/Notice";
import styles from "../ui.module.css";

const cssText = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../ui.module.css"),
  "utf8",
);

describe("Notice", () => {
  it("text (default) renders <p> with role=alert for danger", () => {
    const html = renderToString(<Notice>Ошибка</Notice>);
    expect(html).toContain("<p");
    expect(html).not.toContain("<div");
    expect(html).toContain('data-variant="text"');
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ошибка");
  });

  it("tone success/info default to role=status (polite announcement)", () => {
    expect(renderToString(<Notice tone="success">Ок</Notice>)).toContain(
      'role="status"',
    );
    expect(renderToString(<Notice tone="info">Инфо</Notice>)).toContain(
      'role="status"',
    );
    expect(renderToString(<Notice tone="warning">Осторожно</Notice>)).toContain(
      'role="alert"',
    );
  });

  it("explicit role overrides tone default", () => {
    const html = renderToString(
      <Notice tone="danger" role="status">
        Тихо
      </Notice>,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("banner/card render <div>, never <p> (K2: честный DOM-узел под ref)", () => {
    const banner = renderToString(
      <Notice variant="banner" tone="success">
        <span>Текст</span>
        <span>Хвост</span>
      </Notice>,
    );
    expect(banner).toContain("<div");
    expect(banner).not.toContain("<p");
    expect(banner).toContain('data-variant="banner"');

    const card = renderToString(
      <Notice variant="card" tone="info">
        Подсказка
      </Notice>,
    );
    expect(card).toContain("<div");
    expect(card).not.toContain("<p");
    expect(card).toContain('data-variant="card"');
  });

  it("banner renders a single child without spreading (K7)", () => {
    const html = renderToString(
      <Notice variant="banner" tone="success">
        <span>Один ребёнок</span>
      </Notice>,
    );
    expect(html).toContain('data-variant="banner"');
    expect(html).toContain("Один ребёнок");
    // Порядок/состав детей не меняется — раскладку держит CSS (см. ниже).
  });

  it("banner CSS has no space-between (K7 regression)", () => {
    const bannerRule = cssText.match(
      /\.notice\[data-variant="banner"\]\s*\{[^}]*\}/,
    )?.[0];
    expect(bannerRule).toBeDefined();
    // Комментарий внутри правила упоминает space-between — чистим комментарии
    // и проверяем именно свойство justify-content.
    const declarations = bannerRule!.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).not.toMatch(/justify-content\s*:\s*space-between/);
    expect(declarations).toMatch(/justify-content\s*:\s*flex-start/);
    // Хвост вправо — только для 2-го+ ребёнка, одиночный не разъезжается.
    expect(cssText).toContain(
      '.notice[data-variant="banner"] > :last-child:not(:first-child)',
    );
  });

  it("merges className and passes id (aria-describedby link)", () => {
    const html = renderToString(
      <Notice id="field-err" className="extra">
        Ошибка поля
      </Notice>,
    );
    expect(html).toContain(`${styles.notice} extra`);
    expect(html).toContain('id="field-err"');
  });
});
