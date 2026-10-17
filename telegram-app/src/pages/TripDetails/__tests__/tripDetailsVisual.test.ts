// Визуальный контракт шторки деталей поездки.
//
// До 2026-10-17 экран собирался из блоков разной геометрии и читался как
// набор заплаток:
//  1. маршрут — нативный tgui Timeline с padding 32px 44px: 256px высоты на
//     две строки и пустая треть карточки под адресом прибытия;
//  2. действия водителя — четыре залитые кнопки 44px подряд, из них одна
//     disabled: непонятно, какая главная;
//  3. «место» — grid без колонок: три места вертикальными полосами во всю
//     ширину;
//  4. авто — space-between: «Lada Vesta · | графитовый» и «Госномер после
//     брони» переносились каждый по-своему;
//  5. теги — Chip кита (16px через Subheadline) читались как заголовок;
//  6. комментарий — Blockquote с собственной подложкой внутри карточки:
//     «коробка в коробке»;
//  7. кнопка шаринга — «Поделиться поездкой с попутчиком в Telegram»
//     обрезалась многоточием на 390px.
//
// Пины текстовые (jsdom не каскадит CSS-модули — прецедент layoutCss.test.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
// Тест лежит в src/pages/TripDetails/__tests__: до src — три уровня вверх.
const readSrc = (relativePath: string): string =>
  readFileSync(join(here, "..", "..", "..", relativePath), "utf8");

const pageCss = readSrc("pages/TripDetails/TripDetailsPage.module.css");
const heroTsx = readSrc("pages/TripDetails/TripHero.tsx");
const bookingTsx = readSrc("pages/TripDetails/BookingPanel.tsx");
const driverTsx = readSrc("pages/TripDetails/DriverPanel.tsx");
const routeTsx = readSrc("components/TripRouteTimeline.tsx");
const routeCssRaw = readSrc("components/TripRouteTimeline.module.css");
// Комментарии вырезаны: они объясняют отклонения словами и не должны
// ловиться как значения (прецедент tripDetailsBlocks.css.test.ts).
const routeCss = routeCssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

/** Тело правила, чей селектор стоит отдельной строкой. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

describe("маршрут: компактный рельс вместо Timeline", () => {
  it("нативного Timeline в модуле маршрута больше нет", () => {
    // Имя файла/компонента историческое (TripRouteTimeline) — смотрим на
    // использование: импорт кита и JSX-тег.
    expect(routeTsx).not.toContain("@telegram-apps/telegram-ui");
    expect(routeTsx).not.toMatch(/<Timeline/);
  });

  it("список упорядочен: ol/li, а не div'ы", () => {
    expect(routeTsx).toContain("<ol");
    expect(routeTsx).toContain("<li");
  });

  it("время — отдельная колонка фиксированной ширины", () => {
    const time = ruleBody(routeCss, ".time");
    expect(time).toMatch(/width:\s*44px/);
    expect(time).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("линия дотянута до второй точки", () => {
    expect(ruleBody(routeCss, ".line")).toMatch(/margin-bottom:\s*-5px/);
  });

  it("маскированные адреса — одна подсказка на маршрут", () => {
    // Раньше fallback рендерился под каждой остановкой (два абзаца).
    expect(routeTsx).toContain("addressesHidden");
    expect(routeTsx.match(/\{addressesHidden &&/g)?.length).toBe(1);
  });
});

describe("шапка карточки маршрута", () => {
  it("день слева, путь справа — как в карточке поездки", () => {
    const head = ruleBody(pageCss, ".routeHead");
    expect(head).toMatch(/justify-content:\s*space-between/);
    expect(ruleBody(pageCss, ".routeMeta")).toMatch(/color:\s*var\(--app-muted\)/);
  });
});

describe("выбор места: сетка в строку", () => {
  it("у сетки мест есть колонки (регресс: три полосы во всю ширину)", () => {
    const grid = ruleBody(pageCss, ".seatGrid");
    expect(grid).toMatch(/grid-template-columns:/);
    // auto-fit, не auto-fill: иначе пустые треки оставляют «(зан.)» в 64px.
    expect(grid).toContain("auto-fit");
  });

  it("выбранное место — primary, CTA бронирования — primary", () => {
    expect(bookingTsx).toContain('variant="primary"');
  });
});

describe("действия водителя: одна главная кнопка", () => {
  it("вторая шторка не открывается — заявки встроены в детали", () => {
    // Раньше кнопка вела на /trips/my/:id/requests: две модалки друг на
    // друге. Теперь список — часть этой же шторки.
    expect(driverTsx).not.toContain("/trips/my/");
    expect(driverTsx).toContain("TripPassengers");
    // Кнопки-перехода нет (упоминание в комментарии не в счёт).
    expect(driverTsx).not.toMatch(/<Button[^>]*>[^<]*Заявки пассажиров/);
  });

  it("редактирование — outline", () => {
    expect(driverTsx).toMatch(/<Button stretched variant="outline"/);
  });

  it("завершение — outline, отмена — plain + destructive", () => {
    expect(driverTsx).toMatch(/label="Завершить поездку"[\s\S]*?mode="outline"/);
    expect(driverTsx).toMatch(/label="Отменить поездку"[\s\S]*?mode="plain"/);
  });

  it("заголовок группы — мета 13/600, а не второй заголовок экрана", () => {
    expect(driverTsx).toContain("styles.sectionTitle");
    expect(ruleBody(pageCss, ".sectionTitle.sectionTitle")).toMatch(
      /color:\s*var\(--app-muted\)/,
    );
  });
});

describe("авто, теги и комментарий", () => {
  it("авто — иконка + две строки, без space-between по краям", () => {
    const row = ruleBody(pageCss, ".carRow");
    expect(row).not.toContain("space-between");
    expect(heroTsx).toContain("styles.carIcon");
    expect(heroTsx).toContain("styles.carText");
  });

  it("теги — 13px-пилюли списком, а не Chip на 16px", () => {
    expect(heroTsx).toContain("<ul className={styles.tags}>");
    expect(heroTsx).not.toContain('from "@/ui/Chip"');
    expect(ruleBody(pageCss, ".tag")).toMatch(/font-size:\s*13px/);
  });

  it("комментарий — единственная поверхность карточки", () => {
    // Blockquote получает класс, снимающий вторую подложку, и без иконки.
    expect(heroTsx).toContain("styles.noteQuote");
    expect(heroTsx).toContain("topRightIcon={null}");
    const quote = ruleBody(pageCss, ".noteQuote.noteQuote");
    expect(quote).toMatch(/background:\s*transparent/);
    expect(quote).toMatch(/border-radius:\s*0/);
  });
});

describe("шаринг: одна явная кнопка с полной подписью", () => {
  it("подпись короткая и не обрезается", () => {
    expect(heroTsx).toContain("Поделиться поездкой");
    expect(heroTsx).not.toContain("с попутчиком в Telegram");
  });

  it("дубля-иконки шаринга в карточке водителя нет", () => {
    // В карточке водителя остаётся только телефон; шаринг — кнопкой ниже.
    expect(heroTsx).not.toMatch(/aria-label="Поделиться поездкой"/);
  });
});

describe("цена: сильная цифра и подпись в строку", () => {
  it("цена — Headline 19/700", () => {
    expect(bookingTsx).toMatch(/<Headline weight="1"[\s\S]*?item\.price/);
  });

  it("подсказка оплаты не ограничена долей 45% (регресс переноса)", () => {
    expect(ruleBody(pageCss, ".payHint")).not.toContain("max-width: 45%");
  });
});
