// Фасад ui/Section: заголовок секции по умолчанию h2 (у кита жёстко h1) и
// паритет с китовой геометрией/типографикой на обеих платформах.
//
// SSR renderToString, тот же паттерн, что button.test.tsx / card.test.tsx:
// проверяем ВЫВОД обёртки, а не текст CSS-исходников. Значения измерены в
// браузере и закреплены в kitContract.test.tsx.
import { renderToString } from "react-dom/server";
import { AppRoot, Subheadline } from "@telegram-apps/telegram-ui";
import { describe, expect, it } from "vitest";

import { Section } from "@/ui/Section";
import styles from "@/ui/Section.module.css";

// Мок платформы НЕ нужен: фасад берёт контекст AppRoot с фолбэком 'base',
// а не через строгий usePlatform, который бросает вне AppRoot. iOS-ветка —
// в section.ios.test.tsx (там мок нужен, чтобы задать платформу).

const render = (node: React.ReactNode) =>
  renderToString(<AppRoot platform="base">{node}</AppRoot>);

// iOS-ветка здесь не проверяется: SSR берёт getServerSnapshot и платформа
// всегда base. Она живёт в section.ios.test.tsx (jsdom + мок
// @/hooks/usePlatform) — тот же приём, что в sheet.ios.test.tsx.

describe("Section: заголовок по умолчанию h2, h1 — только явный opt-in", () => {
  it("header-строка → h2", () => {
    const html = render(<Section header="Маршрут">тело</Section>);
    expect(html).toContain("<h2");
    expect(html).toContain("Маршрут");
    expect(html).not.toContain("<h1");
  });

  it('headingLevel="h1" → h1 (экран, где секция владеет именем)', () => {
    const html = render(
      <Section header="Кто ищет попутку" headingLevel="h1">
        тело
      </Section>,
    );
    expect(html).toContain("<h1");
    expect(html).not.toContain("<h2");
  });

  it("готовый узел header проходит без изменений", () => {
    // Автор знает, чего хочет: узел не переписывается на h2.
    const html = render(
      <Section header={<em className="x">свой</em>}>тело</Section>,
    );
    expect(html).toContain('<em class="x">свой</em>');
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h2");
  });

  it("headingLevel не течёт в DOM", () => {
    const html = render(<Section header="Маршрут">тело</Section>);
    expect(html).not.toContain("headingLevel");
  });

  it("без header секция рендерится как обычно", () => {
    const html = render(<Section>тело</Section>);
    expect(html).toContain("тело");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h2");
  });
});

describe("Section: обёртка повторяет китовую геометрию", () => {
  it("на базовой платформе — наш класс с паддингом кита", () => {
    const html = render(<Section header="Маршрут">тело</Section>);
    expect(html).toContain(styles.header);
    expect(html).not.toContain(styles.headerIos);
  });

  it("типографика — рецепт Subheadline кита (iOS-ветка в section.ios.test.tsx)", () => {
    // Проп level Subheadline съедает и в DOM не выводит, поэтому сверяем по
    // китовому классу подзаголовка. Именно этот класс, а не h6 по умолчанию,
    // доказывает, что Component задан явно: Subheadline без Component = h6.
    const SUBHEADLINE_CLASS = "tgui-809f1f8a3f64154d";
    const html = render(<Section header="Маршрут">тело</Section>);
    expect(html).toContain(SUBHEADLINE_CLASS);
    expect(html).toContain("<h2");
  });

  it("геометрия обёртки совпадает с китовой Section.Header", () => {
    // Кит отдаёт padding в своём классе; мы повторяем его значениями в
    // Section.module.css. Закреплено измерением — см. kitContract.test.tsx.
    expect(styles.header).toBeTruthy();
    expect(styles.headerIos).toBeTruthy();
  });
});

describe("Section: тело остаётся единственным ребёнком", () => {
  it("SectionBody — один ребёнок, иначе кит вставит Divider между детьми", () => {
    const html = render(
      <Section header="Маршрут">
        <div>тело</div>
      </Section>,
    );
    // Кит вставляет разделители только при нескольких прямых детях.
    expect(html).not.toContain("Divider");
    expect(html).toContain("тело");
  });
});

describe("Section: узел-заголовок не обязан быть нашим Subheadline", () => {
  it("принимает любой узел — реконтракт совпадает с китовым", () => {
    const html = render(
      <Section header={<Subheadline Component="h3">третий</Subheadline>}>
        тело
      </Section>,
    );
    expect(html).toContain("<h3");
  });
});
