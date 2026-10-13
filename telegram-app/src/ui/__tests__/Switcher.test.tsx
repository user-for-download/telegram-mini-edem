// Контракт фасада ui/Switcher — переключатель «одно из N».
//
// Проверяем то, что фасад обещает:
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
//  4) ROVING TABINDEX. В группу входят Tab'ом на ВЫБРАННОМ пункте, остальные
//     выведены из последовательности (`tabindex="-1"`): иначе заявленная
//     семантика APG не выполняется и для `tabs`, где Tab обязан
//     перебрасывать между таб-листами, а не заходить в каждый таб.
//
// Про порядок атрибутов: проверки ниже берут ОТКРЫВАЮЩИЙ ТЕГ нужного id, а
// не подряд идущую подстроку. Прежняя проверка цепляла `id → role → состояние`
// одной строкой — она и ловила, что атрибуты на ОДНОМ элементе, но хрупко
// ломалась от любого нового атрибута (добавление законного `tabindex`
// обрушило её), хотя намерение её было правильным.
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

/** Открывающий тег элемента с данным id — чтобы атрибуты проверялись на ОДНОМ узле. */
function tagOf(html: string, id: string): string {
  const match = new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html);
  if (match === null) throw new Error(`элемент с id="${id}" не найден в разметке`);
  return match[0];
}

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
    const selected = tagOf(html, "search-date-today");
    const other = tagOf(html, "search-date-all");
    expect(selected).toContain('role="radio"');
    expect(selected).toContain('aria-checked="true"');
    expect(other).toContain('role="radio"');
    expect(other).toContain('aria-checked="false"');
  });

  it("roving tabindex: вход в группу только на выбранном", () => {
    // Вход Tab'ом — на том пункте, где пользователь уже стоит; остальные
    // выведены из последовательности, иначе Tab прокликивал бы все N подряд.
    expect(tagOf(html, "search-date-today")).toContain('tabindex="0"');
    expect(tagOf(html, "search-date-all")).toContain('tabindex="-1"');
    expect(tagOf(html, "search-date-tomorrow")).toContain('tabindex="-1"');
    // Ровно один вход в группу: два пункта с tabindex="0" означали бы, что
    // Tab заходит внутрь дважды.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
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
    const selected = tagOf(html, "reviews-tab-new");
    const other = tagOf(html, "reviews-tab-mine");
    expect(selected).toContain('role="tab"');
    expect(selected).toContain('aria-selected="true"');
    expect(other).toContain('role="tab"');
    expect(other).toContain('aria-selected="false"');
  });

  it("roving tabindex и для вкладок: Tab перебрасывает между листами", () => {
    expect(tagOf(html, "reviews-tab-new")).toContain('tabindex="0"');
    expect(tagOf(html, "reviews-tab-mine")).toContain('tabindex="-1"');
  });

  it("aria-controls только на выбранном и равен panelId", () => {
    expect(html.match(/aria-controls="([^"]+)"/g)).toEqual([
      'aria-controls="reviews-panel-new"',
    ]);
  });
});

describe("ui/Switcher: группа не выпадает из Tab-порядка (value вне options)", () => {
  // APG: в roving-группе ровно один tabbable. Если value нет среди options,
  // выбранных нет, и без явного fallback ВСЕ пункты получают tabindex="-1" —
  // группа становится недостижимой с клавиатуры (findIndex даёт -1).
  const html = render(
    <Switcher
      options={OPTIONS}
      value={"missing" as never}
      onChange={() => {}}
      ariaLabel="Дата поездки"
      idPrefix="edge"
    />,
  );

  it("ровно один вход в группу — первый пункт", () => {
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(tagOf(html, "edge-all")).toContain('tabindex="0"');
  });

  it("остальные пункты выведены из последовательности", () => {
    expect(tagOf(html, "edge-today")).toContain('tabindex="-1"');
    expect(tagOf(html, "edge-tomorrow")).toContain('tabindex="-1"');
  });
});
