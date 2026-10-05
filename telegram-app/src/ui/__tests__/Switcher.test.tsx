// Контракт фасада ui/Switcher — переключатель «одно из N».
//
// Проверяем то, что фасад обещает и что раньше расходилось по экранам:
//  1) СЕМАНТИКА. radiogroup/radio/aria-checked для фильтра (без
//     aria-controls) и tablist/tab/aria-selected для вкладок, где
//     aria-controls стоит ТОЛЬКО на выбранном пункте и равен panelId.
//     Кит по умолчанию объявляет вкладками оба случая (dist:
//     SegmentedControl.js спредит ...restProps после role) — фасад обязан
//     это перекрыть.
//  2) КОРЕНЬ. Интерактивный пункт обязан быть нативной кнопкой: дефолт
//     ui/Chip даёт <button> при onClick, иначе div недоступен с клавиатуры.
//  3) ID. `${idPrefix}-${value}` — стабильные: по ним уезжает фокус после
//     стрелки и на них ссылается aria-controls.
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { describe, expect, it } from "vitest";

import { Switcher } from "@/ui/Switcher";

const OPTIONS = [
  { value: "all", label: "Все" },
  { value: "today", label: "Сегодня" },
  { value: "tomorrow", label: "Завтра" },
] as const;

const render = (node: React.ReactNode): string =>
  renderToString(<AppRoot platform="base">{node}</AppRoot>);

describe("ui/Switcher: фильтр (semantics=radiogroup, по умолчанию)", () => {
  const html = render(
    <Switcher
      options={OPTIONS}
      value="today"
      onChange={() => {}}
      ariaLabel="Дата поездки"
      idPrefix="search-date"
    />,
  );

  it("контейнер — radiogroup с доступным именем", () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Дата поездки"');
  });

  it("пункты — role=radio с aria-checked ровно у выбранного", () => {
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    // Порядок атрибутов задаёт спред кита, поэтому цепляем связку
    // id → role → состояние, а не каждый атрибут по отдельности.
    expect(html).toContain('id="search-date-today" role="radio" aria-checked="true"');
    expect(html).toContain('id="search-date-all" role="radio" aria-checked="false"');
  });

  it("aria-controls у фильтра НЕТ — панелей не существует", () => {
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain('role="tab"');
  });

  it("пункт — нативная кнопка", () => {
    expect(html).toContain("<button");
    expect(html).not.toContain("<div aria-pressed");
  });
});

describe("ui/Switcher: вкладки (semantics=tabs)", () => {
  const html = render(
    <Switcher
      options={[
        { value: "mine", label: "Мои" },
        { value: "new", label: "Новая" },
      ]}
      value="new"
      onChange={() => {}}
      ariaLabel="Разделы отзывов"
      idPrefix="reviews-tab"
      semantics="tabs"
      panelId="reviews-panel-new"
    />,
  );

  it("контейнер — tablist", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Разделы отзывов"');
  });

  it("пункты — role=tab с aria-selected", () => {
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('id="reviews-tab-new" role="tab" aria-selected="true"');
    expect(html).toContain('id="reviews-tab-mine" role="tab" aria-selected="false"');
  });

  it("aria-controls только на выбранном и равен panelId", () => {
    expect(html.match(/aria-controls="([^"]+)"/g)).toEqual([
      'aria-controls="reviews-panel-new"',
    ]);
  });
});
