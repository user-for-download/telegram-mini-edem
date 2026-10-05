// Контракт тона ВИДИМОЙ подписи поля (китовый FormInputTitle = <h6>).
//
// Долг, найденный аудитом 2026-10-05: кит красит подпись поля в
// --tgui--secondary_hint_color. Замер в браузере: 2.32:1 на белом и 2.02:1
// на серой подложке контрола (--tgui--secondary_bg_color) — то есть
// подпись поля не проходила WCAG AA (4.5:1) НИГДЕ, а эксперимент с серым
// полем опустил её ещё ниже. Тон задаёт общий --app-field-label, потому что
// подпись рисует кит у каждого Field (Select/Input/Textarea), и локальное
// правило оставило бы долг на остальных полях.
//
// Тест структурный, а не расчётный: color-mix не вычисляется в Node, а
// значения токенов принадлежат киту (копировать их сюда нельзя —
// «свойство токена должно быть одно»). Поэтому закрепляем ЧТО должно быть
// объявлено: оба блока темы, смешение к --tgui--text_color и минимальный
// процент, посчитанный замером. Сам контраст проверен в браузере: 4.52:1
// на серой подложке и 5.18:1 на белой (светлая тема), 4.54 / 5.38 (тёмная).
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
    // Замер: светлая 64% (4.52:1 на #efeff4), тёмная 78% (4.55:1 на
    // #232e3c). Ниже — контраст падает под AA, выше — подпись уходит в
    // основной текст. Порог проверяет и не даёт «осветлить обратно».
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

  it("правило тона живёт в общем слое ui, а не в модуле потребителя", () => {
    // Иначе долг вернётся на поля, которые не CitySelectField.
    const uiCss = readFileSync(
      path.resolve(import.meta.dirname, "../ui.module.css"),
      "utf8",
    );
    expect(uiCss).toMatch(/\.fieldRoot\s+h6\s*\{[^}]*--app-field-label/);
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
});
