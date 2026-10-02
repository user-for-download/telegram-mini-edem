// Тесты примитивов ui/, не покрытых отдельными файлами (Stack, SectionBody,
// CharCounter, Loading, FetchMore). SSR renderToString, паттерн
// ui/__tests__/button.test.tsx. Классы CSS-модулей сверяем по импорту
// модуля (хэшированные имена), как kitContract.test.tsx для Card.
import type { ComponentProps, ReactNode, RefObject } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { describe, expect, it } from "vitest";

import { CharCounter } from "@/ui/CharCounter";
import { Chip } from "@/ui/Chip";
import { FetchMore } from "@/ui/FetchMore";
import { Loading } from "@/ui/Loading";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Stack } from "@/ui/Stack";
import uiStyles from "@/ui/ui.module.css";

const render = (node: ReactNode): string =>
  renderToString(<AppRoot platform="base">{node}</AppRoot>);

/** Текст без SSR-разделителей `<!-- -->` между соседними выражениями. */
const textOf = (html: string): string => html.replace(/<!-- -->/g, "");

describe("Chip: кликабельный по умолчанию нативная кнопка", () => {
  it("с onClick рендерится как button с type=button (без явного Component)", () => {
    // Кит без Component даёт div: с aria-pressed/onClick он недоступен с
    // клавиатуры и читается скринридером как текст. Так были устроены
    // фильтры NotificationsPage и TripActivePage.
    const html = render(<Chip onClick={() => {}}>тег</Chip>);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
  });

  it("статичный чип остаётся div — текстовая плашка, не кнопка", () => {
    const html = render(<Chip>тег</Chip>);
    expect(html).not.toContain("<button");
  });

  it("явный Component=a с href выигрывает у дефолта", () => {
    const html = render(
      <Chip Component={"a"} href="#/ride-requests">
        Заявки
      </Chip>,
    );
    expect(html).toContain('href="#/ride-requests"');
    expect(html).not.toContain("<button");
  });
});

describe("Stack: ритм из токенов, gap-модификаторы", () => {
  it("default — базовый .stack без gap-модификатора", () => {
    const html = render(<Stack>a</Stack>);
    expect(html).toContain(uiStyles.stack);
    expect(html).not.toContain(uiStyles.stackGapXs);
    expect(html).not.toContain(uiStyles.stackGap2xs);
  });

  it("gap=xs и gap=2xs включают свой модификатор", () => {
    expect(render(<Stack gap="xs">a</Stack>)).toContain(uiStyles.stackGapXs);
    expect(render(<Stack gap="2xs">a</Stack>)).toContain(uiStyles.stackGap2xs);
  });

  it("className и rest-атрибуты уходят на div", () => {
    const html = render(
      <Stack className="foo" id="bar">
        a
      </Stack>,
    );
    expect(html).toContain("foo");
    expect(html).toContain('id="bar"');
  });
});

describe("Page: корень экрана, пропсы прокидываются", () => {
  it("scroll — .page без hero, доп. пропсы/ref уходят на List", () => {
    const html = render(
      <Page id="root" data-x="1">
        a
      </Page>,
    );
    expect(html).toContain(uiStyles.page);
    expect(html).not.toContain(uiStyles.pageHero);
    expect(html).toContain('id="root"');
    expect(html).toContain('data-x="1"');
  });

  it("hero добавляет .pageHero", () => {
    expect(render(<Page variant="hero">a</Page>)).toContain(uiStyles.pageHero);
  });
});

describe("SectionBody", () => {
  it("базовый .sectionBody, className мержится", () => {
    const html = render(<SectionBody className="foo">тело</SectionBody>);
    expect(html).toContain(uiStyles.sectionBody);
    expect(html).toContain("foo");
    expect(html).toContain("тело");
  });

  it("стандартные пропсы div прокидываются", () => {
    const html = render(
      <SectionBody id="body" aria-busy="true">
        тело
      </SectionBody>,
    );
    expect(html).toContain('id="body"');
    expect(html).toContain('aria-busy="true"');
  });
});

describe("CharCounter", () => {
  it("формат value/max", () => {
    expect(textOf(render(<CharCounter value={12} max={500} />))).toContain(
      "12/500",
    );
  });
});

describe("Loading: один live-region со спиннером и подписью", () => {
  it("по умолчанию role=status + aria-label Загрузка", () => {
    const html = render(<Loading />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Загрузка"');
    expect(html).toContain(uiStyles.loadingStatus);
  });

  it("label становится доступным именем и видимым текстом", () => {
    const html = render(<Loading label="Загружаем города…" />);
    expect(html).toContain('aria-label="Загружаем города…"');
    expect(html).toContain("Загружаем города…");
  });
});

describe("FetchMore", () => {
  const noop = () => {};

  it("hasNextPage ложный — пустой рендер", () => {
    // Без AppRoot: ветка null не доходит до Button (китовый контекст не нужен).
    const html = renderToString(
      <FetchMore hasNextPage={false} isFetchingNextPage={false} fetchNextPage={noop} />,
    );
    expect(html).toBe("");
  });

  it("sentinel aria-hidden + кнопка с label", () => {
    const ref = { current: null } as RefObject<HTMLDivElement | null>;
    const html = render(
      <FetchMore
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={noop}
        sentinelRef={ref}
        label="Показать ещё"
      />,
    );
    expect(html).toContain(uiStyles.sentinel);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Показать ещё");
  });

  it("без sentinelRef якоря нет (только fallback-кнопка)", () => {
    const html = render(
      <FetchMore hasNextPage isFetchingNextPage={false} fetchNextPage={noop} />,
    );
    expect(html).not.toContain(uiStyles.sentinel);
  });

  it("скелетон виден только при догрузке и объявляется role=status", () => {
    type P = ComponentProps<typeof FetchMore>;
    const base: P = {
      hasNextPage: true,
      isFetchingNextPage: true,
      fetchNextPage: noop,
      placeholder: <span>skeleton</span>,
      placeholderLabel: "Загрузка ещё записей",
    };
    const busy = render(<FetchMore {...base} />);
    expect(busy).toContain("skeleton");
    expect(busy).toContain('role="status"');
    expect(busy).toContain('aria-label="Загрузка ещё записей"');

    const idle = render(<FetchMore {...base} isFetchingNextPage={false} />);
    expect(idle).not.toContain("skeleton");
  });
});
