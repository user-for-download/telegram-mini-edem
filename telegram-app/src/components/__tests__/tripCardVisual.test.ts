// Визуальный контракт карточки поездки (TripStandardCard + заявки водителя).
//
// Карточка — главный экран продукта, и до 2026-10-17 она «рассыпалась»:
//  1. три разных левых вертикали — шапка/маршрут на 16px, китовый Cell и
//     строки заявок на своих 24px, из-за чего аватар стоял правее города;
//  2. пять равно-жирных строк (дата 600, статус 600, цена 700 в цвете
//     ссылки, имя 700, подпись 600) — не было иерархии, всё кричало;
//  3. иконки-пины 16px и пунктирная линия из радиальных точек спорили
//     с текстом и давали муар на мобильном;
//  4. футер был прижат вправо, левая половина полосы пустовала.
//
// Тест пинит ПРИНЦИПЫ, а не пиксельные значения: одна полоса 16px у всех
// блоков, две типографические роли (имя/город/цена против меты), рельс
// из точек, цена цветом текста (реестр #38: сырой --tgui--link_color
// обходит --app-* переопределения тёмной темы). Пины текстовые: jsdom не
// каскадит CSS-модули и не считает layout (прецедент layoutCss.test.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (relativePath: string): string =>
  readFileSync(join(here, "..", "..", relativePath), "utf8");

const cardCss = readSrc("components/Section/TripStandardCard.module.css");
const tripsCss = readSrc("components/Trip/TripCards.module.css");
const cardTsx = readSrc("components/Section/TripStandardCard.tsx");
const requestsTsx = readSrc("components/Trip/DriverTripRequests.tsx");

/** Тело правила, чей селектор стоит отдельной строкой (`sel {`), а не
 * частью списка (`.a, .b {}`): иначе запрос про `.dotTo` попадал бы в
 * общий блок `.dotFrom, .dotTo`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

describe("карточка поездки: одна внутренняя полоса", () => {
  // Полоса 16px (=--app-space-md) у всех блоков — иначе левый край карточки
  // получает несколько вертикалей, и карточка выглядит «собранной из
  // разных компонентов».
  it("шапка, маршрут, персона и футер стоят на --app-space-md", () => {
    expect(ruleBody(cardCss, ".head")).toMatch(
      /padding:\s*14px var\(--app-space-md\)/,
    );
    expect(ruleBody(cardCss, ".route")).toMatch(/var\(--app-space-md\)/);
    expect(ruleBody(cardCss, ".person.person")).toMatch(
      /padding:\s*0 var\(--app-space-md\)/,
    );
    expect(ruleBody(cardCss, ".footer")).toMatch(
      /margin:\s*0 var\(--app-space-md\)/,
    );
  });

  it("строки заявок стоят на той же полосе, что и персона водителя", () => {
    expect(ruleBody(tripsCss, ".requestCell.requestCell")).toMatch(
      /padding:\s*0 var\(--app-space-md\)/,
    );
  });
});

describe("карточка поездки: иерархия типографики", () => {
  it("цена — цветом текста, а не ссылки (реестр #38)", () => {
    const price = ruleBody(cardCss, ".price.price");
    expect(price).toMatch(/color:\s*inherit/);
    expect(price).not.toContain("--tgui--link_color");
  });

  it("мета-подписи не весят как имена: 400 и приглушённый тон", () => {
    expect(ruleBody(cardCss, ".place")).toMatch(/color:\s*var\(--app-muted\)/);
    const subtitle = ruleBody(tripsCss, ".requestSubtitle.requestSubtitle");
    expect(subtitle).toMatch(/font-weight:\s*400/);
    expect(subtitle).toMatch(/color:\s*var\(--app-muted\)/);
  });

  it("имя пассажира и его рейтинг — аддитивные роли (600 у имени)", () => {
    // Подпись заявки в TSX идёт weight="3" (400), имя — weight="2" (600).
    const subtitle = requestsTsx.match(/<Caption[\s\S]*?weight="(\d)"/)?.[1];
    expect(subtitle).toBe("3");
    const name = requestsTsx.match(/className=\{styles\.requestPerson\}[\s\S]*?<Subheadline[^>]*weight="(\d)"/)?.[1];
    expect(name).toBe("2");
  });
});

describe("маршрут: рельс из точек вместо иконок-пинов", () => {
  it("отправление — кольцо, прибытие — заливка", () => {
    expect(ruleBody(cardCss, ".dotFrom")).toMatch(/border:\s*2px solid/);
    expect(ruleBody(cardCss, ".dotTo")).toMatch(/background:\s*var\(--app-info\)/);
  });

  it("линия — сплошная и дотянута до второй точки", () => {
    const line = ruleBody(cardCss, ".line");
    expect(line).toMatch(/background:\s*var\(--app-info\)/);
    // Отрицательный нижний отступ — компенсация margin-top второй точки.
    expect(line).toMatch(/margin-bottom:\s*-5px/);
  });

  it("иконок MapPin/ArrowDown в разметке маршрута больше нет", () => {
    expect(cardTsx).not.toContain("MapPin");
    expect(cardTsx).not.toContain("ArrowDown");
    expect(cardTsx).not.toContain("styles.vbar");
  });
});

describe("футер: действия по краям, а не кучей справа", () => {
  it("space-between использует всю ширину полосы", () => {
    const footer = ruleBody(tripsCss, ".footerEnd.footerEnd");
    expect(footer).toMatch(/justify-content:\s*space-between/);
    expect(footer).toMatch(/width:\s*100%/);
  });
});

describe("рейтинг пассажира: подпись, а не бейдж поверх аватара", () => {
  it("бейдж Avatar.Badge снят с аватара заявки", () => {
    expect(requestsTsx).not.toContain("Avatar.Badge");
  });

  it("рейтинг живёт в строке меты и остаётся тихим", () => {
    expect(requestsTsx).toContain("styles.requestRating");
    // Рейтинг — часть subtitle (мета), а не сосед имени: справа две кнопки
    // по 44px, и колонка имени иначе обрезала ФИО.
    const subtitle = requestsTsx.slice(
      requestsTsx.indexOf("subtitle={"),
      requestsTsx.indexOf("after={"),
    );
    expect(subtitle).toContain("styles.requestRating");
    expect(ruleBody(tripsCss, ".requestRating")).toMatch(
      /color:\s*var\(--app-muted\)/,
    );
  });

  it("без отзывов — прочерк, а не мнимое 5.0", () => {
    // formatRating + hasRating: прочерк остаётся видимым, звезда не рисуется.
    expect(requestsTsx).toContain("hasRating(");
    expect(requestsTsx).toContain("formatRating(");
  });
});
