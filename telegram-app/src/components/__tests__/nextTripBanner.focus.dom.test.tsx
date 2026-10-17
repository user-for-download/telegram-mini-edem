// @vitest-environment jsdom
// A11y-контракт фокуса баннера ближайшей поездки (F28).
//
// Дефект: строка интерактивна (`role="button" tabIndex={0}` на китовом
// `Banner` → `<section>`), но индикатора фокуса не было НИ у кита, НИ в
// модуле — клавиатурный пользователь попадал в невидимую точку остановки
// (WCAG 2.4.7 Focus Visible).
//
// Тест СТРУКТУРНЫЙ, а не рендерящий: jsdom не вычисляет `:focus-visible` и
// вообще не применяет правила каскада псевдоклассов, поэтому «кольцо
// нарисовано» здесь проверить нельзя. Пиняем ЧТО объявлено — наличие
// правила и его совпадение с соседним рецептом репозитория. Визуальный
// результат проверяется в браузере набором e2e (ui-contrast / rhythm),
// а не этим тестом.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { NextTripBanner } from "@/components/Section/NextTripBanner";

// Пути строим от process.cwd(), а НЕ от import.meta.url: в jsdom-окружении
// import.meta.url — http(s)-URL, и createRequire/fileURLToPath на нём падают с
// «The URL must be of scheme file». vitest запускается из telegram-app.
const require = createRequire(join(process.cwd(), "package.json"));
const kitPkgPath = require.resolve("@telegram-apps/telegram-ui/package.json");
const kitCss = readFileSync(join(dirname(kitPkgPath), "dist/styles.css"), "utf8");

// Пути строим от process.cwd(), а НЕ от import.meta.url: в jsdom-окружении
// import.meta.url — http(s)-URL, и fileURLToPath на нём падает с
// «The URL must be of scheme file». vitest запускается из telegram-app.
const bannerCss = readFileSync(
  join(process.cwd(), "src/components/Section/NextTripBanner.module.css"),
  "utf8",
);
const cardCss = readFileSync(
  join(process.cwd(), "src/components/Section/TripStandardCard.module.css"),
  "utf8",
);
const uiCss = readFileSync(
  join(process.cwd(), "src/ui/ui.module.css"),
  "utf8",
);

const { mockUseMyBookings, mockUseInfiniteMyTrips } = vi.hoisted(() => ({
  mockUseMyBookings: vi.fn(),
  mockUseInfiniteMyTrips: vi.fn(),
}));

vi.mock("@/queries/useBookingsQuery", () => ({
  useMyBookingsQuery: mockUseMyBookings,
}));

vi.mock("@/queries/useTripsQuery", () => ({
  useInfiniteMyTripsQuery: mockUseInfiniteMyTrips,
}));

afterEach(cleanup);

/** Ближайшая поездка водителя — чтобы баннер вообще отрисовался. */
function givenDriverTrip() {
  mockUseMyBookings.mockReturnValue({ data: [], isLoading: false });
  mockUseInfiniteMyTrips.mockReturnValue({
    data: {
      pages: [
        {
          items: [
            {
              id: "td",
              fromCity: "Вологда",
              toCity: "Череповец",
              departureAt: new Date(Date.now() + 86_400_000).toISOString(),
              price: 500,
              seatsAvailable: 2,
            },
          ],
          pagination: {},
        },
      ],
    },
    isLoading: false,
  });
}

function renderBanner() {
  givenDriverTrip();
  // MemoryRouter — конвенция репозитория для компонентов с useNavigate
  // (см. modals.test.tsx, tripCard.iconTarget.dom.test.tsx): баннер
  // переходит по `/trips/:id`, и без провайдера useNavigate бросает.
  return render(
    <AppRoot platform="base">
      <MemoryRouter>
        <NextTripBanner />
      </MemoryRouter>
    </AppRoot>,
  );
}

/** Интерактивная строка баннера. */
function banner(): HTMLElement {
  return screen.getByTestId("next-trip-banner");
}

/**
 * Тело правила по селектору (умеет матчить удвоенный `.a.a:focus-visible`).
 *
 * Возвращает null, если правила нет, а не падает: этим же хелпером
 * проверяется ОТСУТСТВИЕ правила (обычного `:focus`), и внутренний
 * expect(not.toBeNull()) ронял бы негативную проверку.
 */
function ruleBody(css: string, selector: string): string | null {
  const match = new RegExp(
    `(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  ).exec(css);
  return match?.[2] ?? null;
}

/** Убирает CSS-комментарии: иначе они слипаются с декларациями при split(";") */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Нормализованные декларации блока: «свойство: значение». */
function declarations(body: string): string[] {
  return stripComments(body)
    .split(";")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

describe("NextTripBanner: точка остановки фокуса", () => {
  // Пин ДО фикса был зелёным здесь и красным в следующем describe: семантика
  // строки (роль/таб-порядок) была верной, не хватало кольца.
  it("строка — это <section> с ролью кнопки, в таб-порядке и с именем", () => {
    renderBanner();
    const row = banner();
    expect(row.tagName).toBe("SECTION");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toMatch(/Вологда — Череповец/);
  });

  it("focus() встаёт на строку, Enter и Space открывают поездку", () => {
    renderBanner();
    const row = banner();
    row.focus();
    expect(document.activeElement).toBe(row);

    // Таб-порядок и активация с клавиатуры НЕ менялись: это поведение
    // компонента, фикс — только CSS.
    fireEvent.keyDown(row, { key: "Enter" });
    expect(row.getAttribute("data-testid")).toBe("next-trip-banner");
    fireEvent.keyDown(row, { key: " " });
    expect(document.activeElement).toBe(row);
  });
});

describe("NextTripBanner: видимый индикатор фокуса (структурный пин)", () => {
  it("для баннера объявлено правило :focus-visible с outline", () => {
    // jsdom не считает каскад — поэтому читаем исходник модуля.
    const body = ruleBody(bannerCss, ".banner\\.banner:focus-visible");
    expect(body, "правило :focus-visible не найдено").not.toBeNull();
    expect(body ?? "", "outline не объявлен").toMatch(
      /outline:\s*var\(--app-focus-width\) solid var\(--app-info\)/,
    );
    expect(body, "нет отступа кольца от поверхности").toMatch(
      /outline-offset:\s*2px/,
    );
  });

  it("рецепт совпадает с соседними открывающими поверхностями", () => {
    // Канон репозитория (.open / .author / .rowInfo / .requestPerson):
    // кольцо из общего токена --app-focus-width и смыслового --app-info
    // (реестр #39: сырой --tgui--link_color минует --app-* и не проходит AA),
    // outline-offset 2px, радиус по токену. Сверяем с .open.open карточки
    // поездки — если тот поменяет рецепт, упадёт здесь.
    const card = declarations(
      ruleBody(cardCss, ".open\\.open:focus-visible") ?? "",
    );
    const ours = declarations(
      ruleBody(bannerCss, ".banner\\.banner:focus-visible") ?? "",
    );
    for (const expected of [
      "outline: var(--app-focus-width) solid var(--app-info)",
      "outline-offset: 2px",
    ]) {
      expect(card, `у соседа нет «${expected}»`).toContain(expected);
      expect(ours, `у баннера нет «${expected}»`).toContain(expected);
    }
    expect(ours).toContain("border-radius: var(--app-card-radius)");
  });

  it("только :focus-visible — мышиный клик кольца не рисует", () => {
    expect(bannerCss).toContain(".banner.banner:focus-visible");
    // Плоское `.banner:focus` (без -visible) у кольца означало бы рамку и
    // при тапе мышью, и при программном фокусе.
    // Плоское `.banner:focus` (без -visible) у кольца означало бы рамку и
    // при тапе мышью, и при программном фокусе. Если такое правило всё же
    // есть — outline в нём быть не должно.
    const plainFocus = ruleBody(bannerCss, ".banner\\.banner:focus");
    if (plainFocus !== null) expect(plainFocus).not.toMatch(/outline/);
    expect(bannerCss).not.toMatch(/\.banner\s*\{[^}]*outline/);
  });

  it("без !important (канон репозитория — удвоение селектора)", () => {
    // Комментарии вырезаем: в самом правиле слово «!important» упоминается
    // как запрет, и наивный поиск по исходнику ловил бы упоминание.
    expect(stripComments(bannerCss)).not.toMatch(/!important/);
    expect(
      ruleBody(bannerCss, ".banner\\.banner:focus-visible") ?? "",
    ).not.toMatch(/!important/);
  });

  it("не конфликтует с общим сбросом outline в ui/ui.module.css", () => {
    // Сброс есть только у тел sheet и только для :focus:not(:focus-visible) —
    // то есть фокус мышью/тачем. Правило баннера оба раза не задевает:
    // оно рисует кольцо, а не гасит его, и не является плоским :focus.
    const resets = [
      ...stripComments(uiCss).matchAll(
        /([^{}]*):focus:not\(:focus-visible\)\s*\{[^}]*\}/g,
      ),
    ];
    expect(resets.length, "общий сброс outline не найден").toBeGreaterThan(0);
    for (const match of resets) {
      // Список селекторов в CSS значит «ЛЮБОЙ из них», а `:focus` висит
      // только на последнем: `.a, .b:focus:not(...)` гасит кольцо лишь у .b.
      // Поэтому проверяем, что ВСЕ селекторы списка — из семейства
      // .sheetBody*, а не то, что каждый из них несёт :focus. Суть проверки:
      // сброс физически не может достать баннер.
      for (const selector of (match[1] ?? "").split(",")) {
        expect(selector.trim()).toMatch(
          /^\.sheetBody(Edge|Static)?(:focus:not\(:focus-visible\))?$/,
        );
      }
      expect(match[0]).toContain("outline: none");
    }
    expect(uiCss).not.toMatch(/\.banner[^{}]*:focus/);
  });

  it("кит сам баннер не покрывает — правило действительно нужно наше", () => {
    // Если при bump версии кит заведёт :focus-visible для Banner, пин
    // упадёт — это сигнал пересмотреть дублирование, а не повод молчать.
    const kitRules = [...kitCss.matchAll(/[^{}]*:focus-visible\s*\{[^}]*\}/g)];
    expect(kitRules.length, "у кита неожиданно много правил фокуса").toBeLessThan(
      3,
    );
    for (const match of kitRules) {
      expect(match[0]).not.toMatch(/tgui-c3d21871b48e0ba3/);
    }
  });
});
