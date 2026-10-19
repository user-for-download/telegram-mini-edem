// Тап-таргет 44px (WCAG 2.5.5 AAA) у компактных триггеров size="s".
//
// Триггер ConfirmPopup — внутренне Button size="s" (~36px у кита), поэтому
// высоту 44 доводит вызывающий код через className={MIN_TARGET} (тот же
// приём, что у Accept/Decline в TripRequestsModal). Кнопки −/+ в строках
// заявок — IconButton size="s" (~28px): им нужен ICON_TARGET (44×44 круг +
// центрирование), потому что MIN_TARGET поднимает только высоту и на
// border-radius:50% даёт овал с иконкой у верхнего края.
//
// Почему пиним текстом исходника, а не DOM: эти компоненты живут за
// провайдерами (роутер, react-query) и в renderToString не собираются, а
// jsdom не каскадит CSS-модули — прецедент layoutCss.test.ts («ловлю
// текстом»). Механизм (MIN_TARGET → data-tap-target/min-height и
// className-сквозняк IconButton кита) проверен DOM-рендером ниже.
//
// Отмена запроса в RideRequestsList — восьмой ConfirmPopup, и тоже через
// MIN_TARGET: раньше высоту ей давал CSS-костыль `.contentsBtn`
// (обёртка display:contents для BTN_ROW-раскладки), теперь триггер стоит
// соседом обычного действия в BTN_ROW — как Accept/Decline в
// TripRequestsModal.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { ConfirmPopup } from "@/components/ConfirmPopup";
import { IconButton } from "@/ui/IconButton";
import { ICON_TARGET, MIN_TARGET } from "@/ui/classes";

const here = dirname(fileURLToPath(import.meta.url));
/** Исходник компонента относительно components/__tests__/. */
const readSrc = (relativePath: string): string =>
  readFileSync(join(here, "..", "..", relativePath), "utf8");

/** Чанки JSX-вызовов компонента: текст от `<Name` до закрывающего `/>`. */
function jsxUsages(source: string, name: string): string[] {
  return source
    .split(`<${name}`)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("/>")));
}

/** Те же вызовы, но для самозакрывающихся и парных форм (IconButton). */
function jsxBlocks(source: string, name: string): string[] {
  const blocks: string[] = [];
  let rest = source;
  while (true) {
    const start = rest.indexOf(`<${name}`);
    if (start === -1) return blocks;
    rest = rest.slice(start);
    const selfClose = rest.indexOf("/>");
    const pairClose = rest.indexOf(`</${name}>`);
    const end =
      selfClose !== -1 && (pairClose === -1 || selfClose < pairClose)
        ? selfClose
        : pairClose;
    blocks.push(rest.slice(0, end));
    rest = rest.slice(end + 1);
  }
}

describe("таргеты ConfirmPopup size=s держат 44px через MIN_TARGET", () => {
  // 7 мест без собственного CSS-костыля: VehicleModal, BookingPanel,
  // ProfilePage (опасная зона), DriverPanel ×2, TripCard ×2.
  const cases: Array<{ file: string; count: number }> = [
    { file: "components/Profile/VehicleModal.tsx", count: 1 },
    { file: "pages/TripDetails/BookingPanel.tsx", count: 1 },
    { file: "pages/Profile/ProfilePage.tsx", count: 1 },
    { file: "pages/TripDetails/DriverPanel.tsx", count: 2 },
    { file: "components/Trip/TripCard.tsx", count: 2 },
    // Восьмой триггер: отмена запроса на попутку — до 2026-10-19 держалась
    // CSS-костылём `.contentsBtn` вместо MIN_TARGET.
    { file: "components/Trip/RideRequestsList.tsx", count: 1 },
  ];
  for (const { file, count } of cases) {
    it(`${file}: все ${count} триггера с MIN_TARGET`, () => {
      const usages = jsxUsages(readSrc(file), "ConfirmPopup");
      expect(usages).toHaveLength(count);
      for (const usage of usages) {
        expect(usage).toContain("MIN_TARGET");
      }
    });
  }

  it("ProfilePage: кнопка «Редактировать профиль» — тоже 44", () => {
    // Единственная кнопка-действие приложения ниже политики: китовые
    // size="s" — 36px, и жили они только здесь (реестр #58). Класс ищем по
    // `styles.heroEdit`: текста кнопки в чанке нет — `jsxUsages` обрывает
    // его на `/>` вложенной иконки.
    const usage = jsxUsages(
      readSrc("pages/Profile/ProfilePage.tsx"),
      "Button",
    ).find((chunk) => chunk.includes("heroEdit"));
    expect(usage, "кнопка правки профиля пропала из исходника").toBeDefined();
    expect(usage).toContain("MIN_TARGET");
    expect(usage).toContain('size="s"');
  });

  it("TripRequestsModal: прецедент Accept/Decline в BTN_ROW на месте", () => {
    // Два stretched size="s" в одном BTN_ROW уже живут с MIN_TARGET —
    // доказательство, что min-height не ломает ряд кнопок.
    const usages = jsxUsages(
      readSrc("components/Trip/TripRequestsModal.tsx"),
      "ConfirmPopup",
    );
    expect(usages).toHaveLength(2);
    for (const usage of usages) {
      expect(usage).toContain("MIN_TARGET");
    }
  });

  it("RideRequestsList: отмена — тихий деструктив в BTN_ROW, костыль .contentsBtn снят", () => {
    const raw = readSrc("components/Trip/RideRequestsList.tsx");
    // Без комментариев: объяснение дефекта само называет снятый класс.
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const usages = jsxUsages(source, "ConfirmPopup");
    expect(usages).toHaveLength(1);
    // 44px — пропом, а не правилом по потомку: `.contentsBtn` был обходом
    // того, что stretched-кнопки в BTN_ROW_WRAP разъезжались в три строки.
    expect(usages[0]).toContain("MIN_TARGET");
    expect(usages[0]).toContain('mode="plain"');
    expect(usages[0]).toContain("destructive");
    expect(source).not.toContain("BTN_ROW_WRAP");
    const css = readSrc("components/Trip/TripModals.module.css");
    expect(css).not.toContain(".contentsBtn");
  });
});

describe("кнопки −/+ заявок (IconButton size=s) держат 44px кругом", () => {
  it("DriverTripRequests: обе иконки с ICON_TARGET", () => {
    const blocks = jsxBlocks(
      readSrc("components/Trip/DriverTripRequests.tsx"),
      "IconButton",
    );
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toContain('size="s"');
      // ICON_TARGET (44×44 + центрирование), а не MIN_TARGET: min-height
      // без min-width на border-radius:50% даёт овал и иконку у верха.
      expect(block).toContain("ICON_TARGET");
      expect(block).not.toContain("MIN_TARGET");
    }
  });

  it("крестик «Отклонить» — outline-вариант (кольцо), галочка — secondary", () => {
    const blocks = jsxBlocks(
      readSrc("components/Trip/DriverTripRequests.tsx"),
      "IconButton",
    );
    const decline = blocks.find((block) => block.includes("Отклонить заявку"));
    const accept = blocks.find((block) => block.includes("Принять заявку"));
    expect(decline).toBeDefined();
    expect(accept).toBeDefined();
    expect(decline).toContain('variant="outline"');
    expect(accept).toContain('variant="secondary"');
  });
});

describe("комментарий заявки переносится, а не обрезается", () => {
  it("Cell заявки включает документированный проп multiline", () => {
    const blocks = jsxBlocks(
      readSrc("components/Trip/DriverTripRequests.tsx"),
      "Cell",
    );
    const requestCell = blocks.find((block) => block.includes("requestCell"));
    expect(requestCell).toBeDefined();
    // Без multiline кит ставит white-space: nowrap + ellipsis на subtitle.
    expect(requestCell).toContain("multiline");
  });

  it("CSS: средняя колонка шире китовых 24px, длинные слова переносятся", () => {
    const css = readSrc("components/Trip/TripCards.module.css");
    // gap 12 (--app-space-sm) вместо 24 кита: комментарию нужна ширина.
    expect(css).toMatch(
      /\.requestCell\.requestCell\s*\{[^}]*gap:\s*var\(--app-space-sm\)/,
    );
    // Слово без пробелов (ссылка/ник) не вылезает за колонку.
    expect(css).toMatch(
      /\.requestSubtitle\.requestSubtitle\s*\{[^}]*overflow-wrap:\s*anywhere/,
    );
  });
});

describe("деструктивный тон один: --app-danger, а не сырой kit-токен", () => {
  // Два «красных» рядом (крестик заявки и «Отменить поездку») обязаны
  // совпадать: --app-danger — смешение под контраст 4.5+, а
  // --tgui--destructive_text_color светлее и даёт другой оттенок.
  it("TripCards.module.css: .declineIcon — красный крестик, нейтральное кольцо", () => {
    const css = readSrc("components/Trip/TripCards.module.css");
    const body = css.match(/\.declineIcon\.declineIcon\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toContain("color: var(--app-danger)");
    // Рамка — как у «Отменить поездку» (outline-режим кита), не красная.
    expect(body).toContain("box-shadow: 0 0 0 1px var(--tgui--outline)");
    expect(body).not.toContain("--tgui--destructive_text_color");
  });

  it("TripModals.module.css: .declineButton — --app-danger", () => {
    const css = readSrc("components/Trip/TripModals.module.css");
    const body = css.match(/\.declineButton\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toContain("var(--app-danger)");
    expect(body).not.toContain("--tgui--destructive_text_color");
  });
});

describe("имя пассажира: тап-таргет без отступа до «место/комментарий»", () => {
  it("44px держит ::after, а не min-height (иначе полоса между ФИО и subtitle)", () => {
    const css = readSrc("components/Trip/TripCards.module.css");
    const rule =
      css.match(/\.requestPerson\.requestPerson\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("position: relative");
    // min-height в потоке растягивал кнопку и создавал пустую полосу.
    expect(rule).not.toContain("min-height");

    const hitArea =
      css.match(/\.requestPerson\.requestPerson::after\s*\{([^}]*)\}/)?.[1] ??
      "";
    expect(hitArea).toContain("position: absolute");
    expect(hitArea).toContain("height: 44px");
  });
});

describe("механизм: MIN_TARGET доходит до DOM", () => {
  it("ConfirmPopup с MIN_TARGET выставляет триггеру data-tap-target=44", () => {
    const withTarget = renderToString(
      <AppRoot platform="base">
        <ConfirmPopup
          label="Отменить"
          confirmLabel="Отменить поездку"
          description="Поездка станет недоступна."
          className={MIN_TARGET}
          onConfirm={() => {}}
        />
      </AppRoot>,
    );
    const withoutTarget = renderToString(
      <AppRoot platform="base">
        <ConfirmPopup
          label="Отменить"
          confirmLabel="Отменить поездку"
          description="Поездка станет недоступна."
          onConfirm={() => {}}
        />
      </AppRoot>,
    );
    // Один и тот же триггер: с классом — таргет 44, без — компактный.
    // Разница доказывает, что пин выше проверяет не мёртвый проп.
    expect(withTarget).toContain('data-tap-target="44"');
    expect(withoutTarget).not.toContain("data-tap-target");
  });

  it("IconButton size=s прокидывает MIN_TARGET в class кнопки", () => {
    const html = renderToString(
      <AppRoot platform="base">
        <IconButton size="s" aria-label="Принять заявку" className={MIN_TARGET}>
          <span>+</span>
        </IconButton>
      </AppRoot>,
    );
    // MIN_TARGET импортирован из того же модуля, что у компонента, —
    // сравнение идёт по хэшированному имени, а не по исходному.
    expect(html).toContain(MIN_TARGET);
  });

  it("IconButton size=s прокидывает ICON_TARGET (круг 44×44) в class", () => {
    const html = renderToString(
      <AppRoot platform="base">
        <IconButton size="s" aria-label="Принять заявку" className={ICON_TARGET}>
          <span>+</span>
        </IconButton>
      </AppRoot>,
    );
    expect(html).toContain(ICON_TARGET);
  });
});

describe("своп городов — 44×44 в своей колонке на обеих формах", () => {
  // Один и тот же контрол стоит в «Поиске» и в «Создании поездки», поэтому
  // рецепт (сетка + ICON_TARGET + variant="gray") обязан совпадать: в
  // «Создании поездки» он до 2026-10-19 оставался на старом приёме —
  // 26×26 в потоке на margin: -16px, поверх поля (реестр #54, #17).
  const forms = [
    ["pages/Search/SearchPage.tsx", "pages/Search/SearchPage.module.css"],
    [
      "pages/CreateTrip/CreateTripPage.tsx",
      "pages/CreateTrip/CreateTripPage.module.css",
    ],
  ] as const;

  /** Тело CSS-правила по селектору (`.swap.swap`) без комментариев. */
  const ruleBody = (css: string, selector: string): string => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const at = clean.indexOf(`${selector} {`);
    if (at === -1) return "";
    return clean.slice(at, clean.indexOf("}", at));
  };

  for (const [tsxFile, cssFile] of forms) {
    it(`${tsxFile}: своп с ICON_TARGET, без size="s"`, () => {
      const blocks = jsxBlocks(readSrc(tsxFile), "IconButton");
      const swap = blocks.find((block) =>
        block.includes("Поменять направление"),
      );
      expect(swap).toBeDefined();
      // 44×44 круг — ICON_TARGET (min-width + min-height), а не MIN_TARGET:
      // высота без ширины на border-radius:50% даёт овал.
      expect(swap).toContain("ICON_TARGET");
      expect(swap).toContain('variant="gray"');
      expect(swap).not.toContain('size="s"');
    });

    it(`${cssFile}: своп — колонка сетки, без минус-отступов`, () => {
      const body = ruleBody(readSrc(cssFile), ".swap.swap");
      expect(body).toContain("grid-area: 1 / 2 / 3 / 3");
      expect(body).not.toContain("margin");
      // Поля — по своей колонке, кнопка занимает обе строки.
      const fields = readSrc(cssFile);
      expect(fields).toContain("grid-template-columns: minmax(0, 1fr) auto");
      expect(fields).toContain(".cityFields > div:first-of-type");
    });
  }
});
