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
// Отмена запроса в RideRequestsList — восьмой ConfirmPopup: высоту ей даёт
// не проп, а CSS `.contentsBtn button { min-height: 44px }` (обёртка
// display:contents не участвует в BTN_ROW-раскладке) — пин ниже.
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

  it("RideRequestsList: отмена держит 44px через .contentsBtn (без BTN_ROW-поломки)", () => {
    const css = readSrc("components/Trip/TripModals.module.css");
    expect(css).toMatch(/\.contentsBtn\s*\{[^}]*display:\s*contents/);
    expect(css).toMatch(/\.contentsBtn button\s*\{[^}]*min-height:\s*44px/);
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
