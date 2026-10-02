import type { ComponentProps } from "react";
import {
  Caption,
  Section as TguiSection,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import { useTguiPlatform } from "@/ui/useTguiPlatform";
import styles from "./Section.module.css";

/**
 * Секция с заголовком по умолчанию `h2`.
 *
 * Кит зашивает `Component: "h1"` в SectionHeader, и переопределить его
 * пропом нельзя. Строка-примитив оборачивается китом в `<header>` с h1
 * внутри, поэтому страница из нескольких секций получала по `h1` на
 * заголовок (замер: 4 на Поддержке, 6 на Профиле, 3 на форме поездки) —
 * при том что NavHeader помечен aria-hidden («авторитетные h1 живут на
 * страницах») и своего h1 у страниц не было.
 *
 * Обойти можно: кит оборачивает в Section.Header ТОЛЬКО примитив, узел
 * пропускает как есть. Но обход теряет обёртку `<header>`, а в ней —
 * геометрия и цвет заголовка (padding 20px 24px 4px 22px / на iOS
 * 16px 16px 8px). Поэтому здесь своя обёртка с теми же значениями, а
 * типографика повторяет рецепт самого кита (useHeaderComponents):
 * iOS — `Caption caps` (13px), остальное — `Subheadline level=2 weight=2`
 * (15px/600). Обе ветки закреплены замерами в kitContract.test.tsx.
 *
 * Явный `header`-узел передаётся без изменений; `headingLevel="h1"` —
 * для экрана, где секция ВИДИМО владеет единственным заголовком
 * (Главная, Поиск: там заголовок секции и есть имя экрана).
 */
export type SectionHeadingLevel = "h1" | "h2";

export interface SectionProps extends ComponentProps<typeof TguiSection> {
  /** Тег заголовка секции. По умолчанию h2 — h1 у секции быть не должно. */
  headingLevel?: SectionHeadingLevel;
}

function isPrimitive(node: unknown): node is string | number {
  return typeof node === "string" || typeof node === "number";
}

export function Section({
  header,
  headingLevel = "h2",
  ...restProps
}: SectionProps) {
  const platform = useTguiPlatform();

  // Узел пропускаем как есть: автор знает, чего хочет (уже минувший
  // рецепт с узлом — см. комментарий выше).
  const resolvedHeader = isPrimitive(header) ? (
    <header className={platform === "ios" ? styles.headerIos : styles.header}>
      {platform === "ios" ? (
        <Caption caps Component={headingLevel}>
          {header}
        </Caption>
      ) : (
        <Subheadline Component={headingLevel} level="2" weight="2">
          {header}
        </Subheadline>
      )}
    </header>
  ) : (
    header
  );

  return <TguiSection header={resolvedHeader} {...restProps} />;
}
