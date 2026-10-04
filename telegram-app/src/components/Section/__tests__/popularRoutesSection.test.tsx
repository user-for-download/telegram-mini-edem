// PopularRoutesSection: два контракта, оба проверены замером 2026-10-03.
//
// 1. Строка маршрута — НАТИВНАЯ кнопка. До правки кит рендерил `<div>`:
//    замер на главной давал 5 строк с tag=DIV, role=null, tabindex=null,
//    focusable=false и НОЛЬ фокусируемых узлов на секции, то есть все
//    «популярные направления» были доступны только мышью (WCAG 2.1.1
//    Keyboard, 4.1.2 Name/Role/Value).
//
// 2. Наружу уходит id справочника, а не имя. POPULAR_ROUTES хранит имена
//    (так их писали в cities-data), а onSelect принимает id — типы у строк
//    совпадают, и компилятор не мешает передать имя в параметр, который
//    значит id. Замер поймал: в URL уезжало `fromCityId=Вологда`, и оба
//    селекта поиска схлопывались на один город.
//
// SSR-рендер (renderToString), как в соседних тестах разделов.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseAllCities } = vi.hoisted(() => ({
  mockUseAllCities: vi.fn(),
}));

vi.mock("@/queries/useAllCities", () => ({
  useAllCitiesQuery: mockUseAllCities,
}));

import { PopularRoutesSection } from "@/components/Section/PopularRoutesSection";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";

const VOLOGDA = { id: "11111111-1111-4111-8111-111111111111", name: "Вологда" };
const CHEREPOVETSK = { id: "22222222-2222-4222-8222-222222222222", name: "Череповец" };
const SOKOL = { id: "33333333-3333-4333-8333-333333333333", name: "Сокол" };

function render() {
  // AppRoot обязателен: кит вне него бросает [TGUI] Wrap your app with <AppRoot>.
  return renderToString(
    <AppRoot platform="base">
      <PopularRoutesSection onSelect={() => {}} />
    </AppRoot>,
  );
}

describe("PopularRoutesSection", () => {
  it("строки маршрутов — нативные кнопки, а не div", () => {
    mockUseAllCities.mockReturnValue({
      data: [VOLOGDA, CHEREPOVETSK, SOKOL],
    });
    const html = render();
    // Каждый маршрут обязан быть <button …type="button">: без этого кит даёт
    // div без роли и без tabindex — строка не фокусируется Tab'ом.
    const buttons = html.match(/<button/g) ?? [];
    // Разделитель направления, а не «Вологда →»: SSR ставит между соседними
    // текстовыми узлами маркер `<!-- -->` (конвенция зафиксирована в MEMORY),
    // поэтому имя и стрелка не оказываются рядом в строке HTML.
    const routes = html.match(/→/g) ?? [];
    expect(routes.length).toBe(POPULAR_ROUTES.length);
    expect(buttons.length).toBeGreaterThanOrEqual(routes.length);
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).not.toMatch(/<div[^>]*type="button"/);
  });

  it("резолвит имена из справочника в id (а не пробрасывает имя)", () => {
    // Проверяем по коду компонента: сам факт резолва виден только в клике,
    // а renderToString клик не воспроизводит. Поэтому здесь — asserts на
    // исходник, а поведение клика закрыто замером в браузере.
    mockUseAllCities.mockReturnValue({ data: [VOLOGDA, CHEREPOVETSK, SOKOL] });
    const src = readFileSync(
      new URL("../PopularRoutesSection.tsx", import.meta.url),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).toContain("byName.get(route.from)");
    expect(code).toContain("byName.get(route.to)");
    expect(code).not.toContain("onSelect(route.from, route.to)");
  });

  it("у первого маршрута оба города есть в справочнике сида", () => {
    // Резолв молча ничего не делает (тап без эффекта), если имени нет в
    // справочнике: POPULAR_ROUTES написан по cities-data, и сид обязан
    // содержать эти города. Проверяем на настоящем справочнике репозитория,
    // а не на фикстуре — иначе тест ничего не защищал бы.
    const citiesData = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../backend/prisma/cities-data.ts"),
      "utf8",
    );
    const [first] = POPULAR_ROUTES;
    expect(first).toBeDefined();
    expect(citiesData).toContain(`"${first!.from}"`);
    expect(citiesData).toContain(`"${first!.to}"`);
  });
});
