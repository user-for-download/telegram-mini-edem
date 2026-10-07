// @vitest-environment jsdom
// iOS-ветка фасада ui/Section: обёртка и типографика повторяют китовые
// значения для iOS (паддинг 16px 16px 8px, Caption caps), тогда как на базовой
// платформе — 20px 24px 4px 22px и Subheadline level=2 weight=2.
// Мок платформы — тот же приём, что в sheet.ios.test.tsx.
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Section } from "../Section";
import styles from "../Section.module.css";

// Платформа берётся из контекста AppRoot глубоким импортом кита; в vitest
// этот импорт даёт вторую копию модуля AppRootContext, поэтому контекст от
// <AppRoot> из корня пакета до фасада не доходит и всё рисуется в 'base'.
// Тот же приём, что в sheet.ios.test.tsx.
vi.mock("@/hooks/usePlatform", () => ({ usePlatformOrBase: () => "ios" }));

// Китовый класс Subheadline — маркер базовой ветки рецепта заголовка.
const SUBHEADLINE_CLASS = "tgui-809f1f8a3f64154d";

describe("Section iOS", () => {
  it("заголовок по-прежнему h2 — платформа уровень не меняет", () => {
    const { container } = render(
      <AppRoot platform="ios">
        <Section header="Мои поездки">тело</Section>
      </AppRoot>,
    );
    expect(container.querySelector("h2")?.textContent).toBe("Мои поездки");
  });

  it("обёртка — iOS-класс с паддингом кита, не базовый", () => {
    // Запросы ограничены контейнером рендера: автоочистки в этом файле нет,
    // и screen находит заголовки предыдущих тестов.
    const { container } = render(
      <AppRoot platform="ios">
        <Section header="Мои поездки">тело</Section>
      </AppRoot>,
    );
    const heading = container.querySelector("h2");
    const wrapper = heading?.parentElement;
    expect(wrapper?.tagName).toBe("HEADER");
    expect(wrapper?.className).toContain(styles.headerIos);
    expect(wrapper?.className).not.toContain(styles.header);
  });

  it("типографика iOS-ветки отличается от базовой (рецепт кита: Caption caps)", () => {
    // Точные хэш-классы кита закреплены в kitContract.test.tsx — здесь
    // проверяем само различие веток: на iOS useHeaderComponents отдаёт
    // Caption, на остальных платформах Subheadline, и классы заголовка
    // расходятся. Без этого тест не поймает молчаливый откат на base.
    const { container: iosBox } = render(
      <AppRoot platform="ios">
        <Section header="Маршрут">тело</Section>
      </AppRoot>,
    );
    const iosClasses = iosBox.querySelector("h2")?.className ?? "";
    expect(iosClasses).toBeTruthy();
    // Subheadline-класс на iOS не появляется.
    expect(iosClasses).not.toContain(SUBHEADLINE_CLASS);
  });

  it('headingLevel="h1" работает и на iOS', () => {
    const { container } = render(
      <AppRoot platform="ios">
        <Section header="Кого ищут попутчиком" headingLevel="h1">
          тело
        </Section>
      </AppRoot>,
    );
    expect(container.querySelector("h1")?.textContent).toBe(
      "Кого ищут попутчиком",
    );
  });
});
