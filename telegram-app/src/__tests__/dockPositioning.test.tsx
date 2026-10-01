// Проверка ПРИМЕНЕНИЯ стилей позиционирования дока таббара и снэкбара.
//
// Оба правила были написаны удвоенными селекторами (`.tabbar.tabbar`,
// `.snackbar.snackbar`) с ошибочным обоснованием «перебить каскад кита
// специфичностью». Удвоение не повышает специфичность — оно требует, чтобы
// класс стоял в className ДВАЖДЫ. Класс приходил один раз, поэтому правила
// не матчились: тост висел на китовом `bottom: 10px` поверх дока, а док был
// полосой во всю ширину без пилюли — при том что вложенные правила
// (`.tabbar :global(...)`) применялись, а --app-page-pad-bottom уже
// резервировал место под пилюлю.
//
// Текстовые пины в layoutCss.test.ts были зелёными при мёртвых правилах.
// Здесь проверяем class-атрибут реального рендера — но не само по себе
// («класс присутствует» ничего не значит), а то, что класс сел на ТОТ ЖЕ
// узел, на котором у кита стоит `position: fixed`. Именно от этого зависит,
// применится ли наш `bottom`/`left`/`right`. Если кит перенесёт fixed на
// другой узел (или сменит хэш) — тест упадёт.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppRoot, Snackbar, Tabbar } from "@telegram-apps/telegram-ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import tabbarStyles from "@/components/TabsBar/Tabbar.module.css";
import toastStyles from "@/components/Toast/Toast.module.css";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("@telegram-apps/telegram-ui/package.json");
const kitCss = readFileSync(join(dirname(pkgPath), "dist/styles.css"), "utf8");

const render = (node: React.ReactNode): string =>
  renderToString(<AppRoot platform="base">{node}</AppRoot>);

/** Модули типизированы `string | undefined` — сужаем: пустой класс означал бы
 *  «правила нет», и тест обязан падать на этом, а не сравнивать с undefined. */
function moduleClass(v: string | undefined, name: string): string {
  if (typeof v !== "string" || v === "") {
    throw new Error(`CSS-модуль не экспортирует .${name}`);
  }
  return v;
}
const TABBAR = moduleClass(tabbarStyles.tabbar, "tabbar");
const SNACKBAR = moduleClass(toastStyles.snackbar, "snackbar");

/** Классы узла, содержащего заданный класс. */
const classesOfNodeWith = (html: string, cls: string): string[] => {
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    const list = (m[1] ?? "").split(/\s+/).filter(Boolean);
    if (list.includes(cls)) return list;
  }
  return [];
};

/** Кит объявляет position:fixed ровно для этого класса (пин хэша). */
function kitRule(cls: string): string {
  const m = kitCss.match(new RegExp(`\\.${cls}\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

/** Код CSS модуля без комментариев (комментарии упоминают старый селектор). */
const cssCode = (p: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", p), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

/**
 * Селектор правила обязан быть ОДИНОЧНЫМ. Это вторая, не менее важная
 * половина условия «правило применится»: класс в DOM (проверяем выше) плюс
 * селектор `.X` вместо `.X.X`. Проверка только по DOM молча проходила бы
 * при возвращённом удвоении — мы это видели.
 */
function expectSingleSelector(css: string, cls: string): void {
  expect(css).toMatch(new RegExp(`^\\.${cls}\\s*[,{]`, "m"));
  expect(css).not.toMatch(new RegExp(`\\.${cls}\\s*\\.${cls}`));
}

describe("док таббара: наш класс сел на узел китово position:fixed", () => {
  // Корневой класс китового Tabbar, нёсший позиционирование (dist 2.1.13).
  const KIT_FIXED = "tgui-7a5facec9dc28fae";

  it("пин: у этого класса кита действительно position:fixed", () => {
    expect(kitRule(KIT_FIXED)).toContain("position:fixed");
  });

  it("наш .tabbar применён и находится на том же узле, что и fixed-класс кита", () => {
    expect(TABBAR).toBeTruthy();
    const html = render(
      <Tabbar className={TABBAR}>
        {[
          <Tabbar.Item key="a" text="Поиск" />,
          <Tabbar.Item key="b" text="Лента" />,
        ]}
      </Tabbar>,
    );
    const classes = classesOfNodeWith(html, TABBAR);
    // Узел найден и несёт наш класс…
    expect(classes).toContain(TABBAR);
    // …и на нём же стоит fixed-класс кита → наши bottom/left/right применимы.
    expect(classes).toContain(KIT_FIXED);
  });

  it("селектор .tabbar одиночный — иначе правило не сматчится", () => {
    expectSingleSelector(cssCode("components/TabsBar/Tabbar.module.css"), "tabbar");
  });

  it("вложенные правила таббара живые: одиночный .tabbar в class", () => {
    // Регрессия-фикса: если бы .tabbar остался удвоенным, вложенные
    // правила перестали бы работать вместе с контейнерными.
    const html = render(
      <Tabbar className={TABBAR}>
        {[
          <Tabbar.Item key="a" text="Поиск" />,
          <Tabbar.Item key="b" text="Лента" />,
        ]}
      </Tabbar>,
    );
    const count = (html.match(new RegExp(TABBAR!, "g")) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("снэкбар: наш класс сел на узел китово position:fixed", () => {
  // Корневой класс китового Snackbar: position:fixed; bottom:10px.
  const KIT_FIXED = "tgui-bed09b0692380ce7";

  it("пин: у этого класса кита действительно position:fixed и свой bottom", () => {
    const rule = kitRule(KIT_FIXED);
    expect(rule).toContain("position:fixed");
    // Если бы кит перестал задавать bottom, наш override был бы не нужен —
    // тест напомнит об этом при бампе версии.
    expect(rule).toContain("bottom:10px");
  });

  it("наш .snackbar применён и находится на том же узле, что и fixed-класс кита", () => {
    expect(SNACKBAR).toBeTruthy();
    const html = render(
      <Snackbar className={SNACKBAR} onClose={() => {}} description="Описание" duration={1}>
        Текст
      </Snackbar>,
    );
    const classes = classesOfNodeWith(html, SNACKBAR);
    expect(classes).toContain(SNACKBAR);
    expect(classes).toContain(KIT_FIXED);
  });

  it("селектор .snackbar одиночный — иначе правило не сматчится", () => {
    expectSingleSelector(cssCode("components/Toast/Toast.module.css"), "snackbar");
  });

  it("класс .snackbar приходит ровно один раз (не удвоен в className)", () => {
    const html = render(
      <Snackbar className={SNACKBAR} onClose={() => {}} description="Описание" duration={1}>
        Текст
      </Snackbar>,
    );
    const classes = classesOfNodeWith(html, SNACKBAR);
    expect(classes.filter((c) => c === SNACKBAR)).toHaveLength(1);
  });
});
