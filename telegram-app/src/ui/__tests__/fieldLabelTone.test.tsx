// Контракт тона ВИДИМОЙ подписи поля (ui/Field, класс .fieldLabel).
//
// Подпись рисует сам Field на всех платформах (китовый header не
// используем). Тон — общий --app-field-label: локальное правило в модуле
// потребителя оставило бы долг на остальных полях.
//
// Тест структурный, а не расчётный: color-mix не вычисляется в Node, а
// значения токенов принадлежат киту (копировать их сюда нельзя —
// «свойство токена должно быть одно»). Поэтому закрепляем ЧТО должно быть
// объявлено: оба блока темы, смешение к --tgui--text_color и минимальный
// процент для 4.5:1. Сам контраст проверен в браузере (на фоне секции:
// светлая 5.18:1, тёмная 5.38:1).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { AppRoot, Input } from "@telegram-apps/telegram-ui";
import { Field } from "@/ui/Field";

const indexCss = readFileSync(
  path.resolve(import.meta.dirname, "../../index.css"),
  "utf8",
);

/** Блок объявлений одной темы: от маркера до закрывающей скобки. */
function themeBlock(marker: string): string {
  const start = indexCss.indexOf(marker);
  expect(start, `маркер темы ${marker} не найден`).toBeGreaterThan(-1);
  const end = indexCss.indexOf("\n}", start);
  return indexCss.slice(start, end);
}

describe("--app-field-label: тон видимой подписи поля", () => {
  it("объявлен в обеих темах и смешивается к --tgui--text_color", () => {
    for (const marker of [".app-theme {", ".dark .app-theme {"]) {
      const block = themeBlock(marker);
      expect(block, `${marker}: токен не объявлен`).toContain(
        "--app-field-label:",
      );
      expect(block, `${marker}: нет secondary_hint_color`).toContain(
        "var(--tgui--secondary_hint_color)",
      );
      // К --tgui--text_color, а не к литеральным black/white: так тон
      // следует за темой клиента и переживает смену палитры.
      expect(block, `${marker}: нет text_color`).toContain(
        "var(--tgui--text_color)",
      );
    }
  });

  it("процент не ниже измеренного минимума для 4.5:1", () => {
    // Светлая 64%, тёмная 78%. Ниже — контраст падает под AA, выше —
    // подпись уходит в основной текст. Порог не даёт «осветлить обратно».
    const percent = (marker: string): number => {
      const block = themeBlock(marker);
      const match = /--app-field-label:[\s\S]*?secondary_hint_color\)\s*(\d+)%/.exec(
        block,
      );
      expect(match, `${marker}: не найден процент смешения`).not.toBeNull();
      return Number(match?.[1]);
    };
    expect(percent(".app-theme {")).toBeGreaterThanOrEqual(64);
    expect(percent(".dark .app-theme {")).toBeGreaterThanOrEqual(78);
  });

  it("правило тона — на классе подписи фасада, а не в модуле потребителя", () => {
    const uiCss = readFileSync(
      path.resolve(import.meta.dirname, "../ui.module.css"),
      "utf8",
    );
    expect(uiCss).toMatch(/\.fieldLabel\s*\{[^}]*--app-field-label/);
  });

  it("подложка контрола — серый фон на внутреннем label кита", () => {
    // Все редактируемые поля видны на белой секции: правило общее,
    // а не копия в модуле потребителя.
    const uiCss = readFileSync(
      path.resolve(import.meta.dirname, "../ui.module.css"),
      "utf8",
    );
    expect(uiCss).toMatch(
      /\.fieldRoot\s*>\s*div\s*>\s*label\s*\{[^}]*--tgui--secondary_bg_color/,
    );
  });

  it("плейсхолдер — приглушённый тон, а не китовый hint", () => {
    // Китовый secondary_hint_color ниже AA на серой подложке.
    const uiCss = readFileSync(
      path.resolve(import.meta.dirname, "../ui.module.css"),
      "utf8",
    );
    expect(uiCss).toContain("::placeholder");
    expect(uiCss).toContain("::-moz-placeholder");
    const rule = uiCss.match(/[^{}]*placeholder[^{}]*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("--app-muted");
  });
});

describe("Field: базовый класс фасада всегда применён", () => {
  const render = (node: React.ReactNode) =>
    renderToString(<AppRoot platform="base">{node}</AppRoot>);

  it("поле без className потребителя всё равно несёт класс фасада", () => {
    const html = render(
      <Field label="Адрес" id="f-1">
        {(field) => <Input {...field} value="" onChange={() => {}} />}
      </Field>,
    );
    expect(html).toMatch(/class="[^"]*fieldRoot/);
  });

  it("класс потребителя сохраняется и дополняется базовым", () => {
    const html = render(
      <Field label="Город" id="f-2" className="consumer-class">
        {(field) => <Input {...field} value="" onChange={() => {}} />}
      </Field>,
    );
    expect(html).toContain("fieldRoot");
    expect(html).toContain("consumer-class");
  });

  it("структура кита прежняя: контрол — div > label", () => {
    // Селектор подложки зависит от вложенности FormInput; при bump кита
    // сверить. SSR-разметка — tripwire: пропал div между fieldRoot
    // и label — правило мёртвое.
    const html = render(
      <Field label="Адрес" id="f-1">
        {(field) => <Input {...field} value="" onChange={() => {}} />}
      </Field>,
    );
    expect(html).toMatch(/fieldRoot[\s\S]*<div[^>]*>\s*<label/);
  });
});
