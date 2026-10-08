// @vitest-environment jsdom
// Контракт фасада ui/SwitchRow — общей строки-переключателя.
//
// Проверяем DOM, а не текст исходника: инварианты строки («это switch, а не
// чекбокс», «строка не кнопка») — свойства РАЗМЕТКИ, и пиннить их разбором
// кода значит пиннить форму записи, а не поведение. Прежний пин жил в
// `pages/Profile/__tests__/switchRow.test.ts` и читал приватное объявление
// внутри `ProfilePage.tsx`; после выноса правило проверяется здесь, у
// владельца, а не у потребителя.
//
// Файл в jsdom, а не SSR как у соседних ui-пинов: нужно кликнуть по
// переключателю и поймать `onChange`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { SwitchRow } from "@/ui/SwitchRow";
import styles from "@/ui/SwitchRow.module.css";

/**
 * Класс фасадного компонента. CSS-модули типизированы `string | undefined`,
 * поэтому сужаем один раз: если бы `.row` пропал из SwitchRow.module.css,
 * тест обязан упасть здесь, а не сравнивать разметку с `undefined`
 * (то же, что в card/cell-тестах).
 */
const OWN_CLASS = ((): string => {
  const cls: string | undefined = styles.row;
  if (typeof cls !== "string" || cls === "") {
    throw new Error("ui/SwitchRow.module.css: класс .row отсутствует");
  }
  return cls;
})();

/** vitest здесь без globals, поэтому авто-cleanup RTL не включается. */
afterEach(cleanup);

/**
 * Узлы, которые человек может нажать/зафокусировать. Ровно один на строку —
 * сам `Switch`. Список задан явно, а не «всё, что умеет RTL»: кнопка внутри
 * строки — ровно тот дефект, который тут и ловится.
 */
const CONTROLS = 'input, button, a[href], select, textarea, [role="button"]';

/**
 * Рендер одной строки. Все запросы — ВНУТРИ `container`: несколько строк в
 * одном тесте склеиваются в `document.body`, и глобальный `screen` на второй
 * раз упал бы на «нашлось несколько элементов» вместо проверки инварианта.
 */
// CSS кита — источник истины по «какой класс снимает nowrap». Хеш не
// хардкодим: при bump версии кита он меняется, и пин обязан либо остаться
// зелёным, либо упасть понятным сообщением, а не молча перестать проверять.
// CSS кита — источник истины по «какой класс снимает nowrap». Хеш не
// хардкодим: при bump версии кита он меняется, и пин обязан либо остаться
// зелёным, либо упасть понятным сообщением, а не молча перестать проверять.
//
// Путь резолвим от КОРНЯ МОНОРЕПО: пакет лежит в корневом node_modules, а
// vitest запускается с cwd = корень workspace, где своего node_modules с
// этим пакетом может не быть.
const KIT_CSS_PATH = new URL(
  "node_modules/@telegram-apps/telegram-ui/dist/styles.css",
  `file://${process.cwd().replace(/\/telegram-app$/, "")}/`,
).pathname;
const kitCss = readFileSync(KIT_CSS_PATH, "utf8");

function renderRow(props: Partial<ComponentProps<typeof SwitchRow>> = {}) {
  const { container } = render(
    <AppRoot platform="base">
      <SwitchRow
        icon={<span>ИКОНКА</span>}
        title="Тёмная тема"
        subtitle="Включена тёмная тема (как в Telegram)"
        label="Тёмная тема"
        checked={false}
        onChange={() => {}}
        {...props}
      />
    </AppRoot>,
  );
  return {
    container,
    /** Узел переключателя — тот, на котором объявлена роль. */
    sw: () => within(container).getByRole("switch"),
    /** Узлы с нашим классом обёртки (обычно ровно один — корень строки). */
    ownClassNodes: () =>
      [...container.querySelectorAll("*")].filter((el) =>
        el.classList.contains(OWN_CLASS),
      ),
  };
}

/**
 * Нативный контрол китового `Switch`. Ищем именно его, потому что состояние
 * «вкл/выкл» выводит браузер из `checked` этого input — если бы кит перестал
 * его отдавать, тест обязан упасть на этом месте, а не молча проверять
 * обёртку.
 */
const inputOf = (c: HTMLElement): HTMLInputElement => {
  const el = c.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!el) {
    throw new Error("китовский Switch не отдал input[type=checkbox]");
  }
  return el;
};

describe("ui/SwitchRow: роль switch, а не чекбокс", () => {
  it("на DOM-узле переключателя стоит role=switch", () => {
    // Китовский Switch — это input[type=checkbox], и роль из обёртки не
    // приходит: без явной роли скринридер озвучивает
    // «отмечено/не отмечено» вместо «включено/выключено».
    expect(renderRow().sw()).toBeTruthy();
  });

  it("имя переключателя = label, а не текст клетки", () => {
    const r = renderRow({ title: "Звуковые эффекты", label: "Звуки" });
    expect(within(r.container).getByRole("switch", { name: "Звуки" })).toBeTruthy();
  });

  it("aria-checked НЕ проставлен руками — ни в одном положении", () => {
    // Для input[type=checkbox] браузер выводит aria-checked из checked.
    // Дублирование рискует разойтись с реальным состоянием, поэтому ловим
    // молчаливый возврат атрибута в обоих положениях.
    for (const checked of [true, false]) {
      const r = renderRow({ checked });
      expect(
        r.sw().getAttribute("aria-checked"),
        `checked=${String(checked)}`,
      ).toBeNull();
      expect(inputOf(r.container).getAttribute("aria-checked")).toBeNull();
    }
  });

  it("состояние переключателя меняется вслед за checked", () => {
    // aria-состояния на узле нет (см. выше), поэтому «вкл/выкл» читаем с
    // нативного контрола — это и есть то, во что превращается проверка для
    // скринридера.
    expect(inputOf(renderRow({ checked: true }).container).checked).toBe(true);
    expect(inputOf(renderRow({ checked: false }).container).checked).toBe(false);
  });
});

describe("ui/SwitchRow: строка не кнопка", () => {
  it("в разметке нет ни одной кнопки", () => {
    // Нативный checkbox внутри <button> — невалидная вложенность и двойное
    // срабатывание на Enter/Space (реестр #24). Переключать должен сам Switch.
    expect(renderRow().container.querySelector("button")).toBeNull();
  });

  it("переключатель не лежит внутри <button>", () => {
    expect(renderRow().sw().closest("button")).toBeNull();
  });

  it("единственный управляющий узел строки — сам переключатель", () => {
    // Кликабельность строки целиком означала бы вторую точку входа в
    // таб-порядок и второе действие на тот же переключатель.
    const r = renderRow();
    const controls = [...r.container.querySelectorAll(CONTROLS)];
    expect(controls).toHaveLength(1);
    expect(r.sw().contains(controls[0] as HTMLElement)).toBe(true);
  });

  it("корень строки не объявляет себя кнопкой", () => {
    const root = renderRow().ownClassNodes()[0];
    expect(root, "SwitchRow не добавил свой класс обёртке").toBeTruthy();
    expect((root as HTMLElement).getAttribute("role")).not.toBe("button");
  });
});

describe("ui/SwitchRow: контракт с потребителем", () => {
  it("onChange зовётся с НОВЫМ значением, а не с событием", () => {
    const onChange = vi.fn();
    const r = renderRow({ checked: false, onChange });
    fireEvent.click(r.sw());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("onChange зовётся и в обратную сторону", () => {
    const onChange = vi.fn();
    const r = renderRow({ checked: true, onChange });
    fireEvent.click(r.sw());
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("клик мимо переключателя ничего не переключает", () => {
    // Смысл инварианта: у строки нет собственного действия. Клик по корню не
    // должен доходить до `Switch` (кит не слушает родителя) — иначе рядом с
    // переключателем появилась бы вторая, неочевидная зона клика.
    const onChange = vi.fn();
    const r = renderRow({ checked: false, onChange });
    const root = r.ownClassNodes()[0] as HTMLElement;
    fireEvent.click(root);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("заголовок, подпись и иконка на месте", () => {
    const r = renderRow();
    const q = within(r.container);
    expect(q.getByText("Тёмная тема")).toBeTruthy();
    expect(q.getByText("Включена тёмная тема (как в Telegram)")).toBeTruthy();
    expect(q.getByText("ИКОНКА")).toBeTruthy();
  });

  it("собственный класс фасада добавлен один раз и лежит на корне строки", () => {
    // MEMORY §7: «фасадный компонент обязан всегда нести свой класс» — иначе
    // общее правило мёртвое (ровно тот случай, что был с ui/Card).
    // Пин по class-атрибуту, а не по тексту CSS: текстовый пин зеленеет при
    // мёртвом правиле.
    const nodes = renderRow().ownClassNodes();
    expect(nodes).toHaveLength(1);
    // Корень строки — div (Cell по умолчанию), а не кнопка: тот же факт, что
    // и выше, но привязанный к class-атрибуту.
    expect((nodes[0] as HTMLElement).tagName).toBe("DIV");
  });

  it("каждая строка — свой переключатель со своей ролью", () => {
    // Регресс на «переключатель без роли»: на двух строках поиск обязан найти
    // ровно два `switch`, а не ноль (и не четыре, если роль уедет на строку).
    const { container } = render(
      <AppRoot platform="base">
        <>
          <SwitchRow
            icon={<span>i</span>}
            title="Тёмная тема"
            subtitle="Тёмная"
            label="Тёмная тема"
            checked
            onChange={() => {}}
          />
          <SwitchRow
            icon={<span>i</span>}
            title="Звуковые эффекты"
            subtitle="Звук"
            label="Звуковые эффекты"
            checked={false}
            onChange={() => {}}
          />
        </>
      </AppRoot>,
    );
    const rows = container.querySelectorAll(CONTROLS);
    expect(within(container).getAllByRole("switch")).toHaveLength(2);
    expect(rows).toHaveLength(2);
  });
});

/**
 * Многострочность подписи.
 *
 * Класс-модификатор не хардкодим: он выводится из `styles.css` кита по
 * правилу, которое снимает `white-space: nowrap` для содержимого клетки
 * (`.tgui-b8dfba0b5c3d054c:not(<modifier>) …`). Так пин переживает bump версии
 * кита: при смене хеша тест либо останется зелёным, либо упадёт с понятным
 * «в ките нет такого правила», а не молча перестанет что-либо проверять.
 *
 * Смысл проверки: подпись переключателя — объяснение, и обрезанное
 * объяснение врёт. Подпись опции про автозавершение — 60 символов; при
 * дефолтном `nowrap` кита многоточие съедало «а не через сутки».
 */
describe("SwitchRow: подпись не обрезается", () => {
  it("на корне строки есть класс кита, снимающий nowrap", () => {
    // Правило, снимающее nowrap, ищется в CSS кита по шаблону
    // `.tui-...:not(.X)`. Пустой результат = кит изменился, и тест обязан
    // упасть, а не пройти вслепую.
    const rules = kitCss.match(
      /\.tgui-[a-z0-9]+:not\(\.(tgui-[a-z0-9]+)\)/g,
    );
    expect(rules, "в styles.css кита нет правила :not(...) для Cell").not.toBeNull();
    const modifier = /\.(tgui-[a-z0-9]+)\)/.exec(rules?.[0] ?? "")?.[1];
    expect(modifier, "не удалось извлечь класс-модификатор").toBeTruthy();

    const { container } = renderRow();
    expect(container.querySelector(`.${modifier}`)).not.toBeNull();
  });
});
