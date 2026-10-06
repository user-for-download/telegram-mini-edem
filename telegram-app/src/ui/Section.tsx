import type { ComponentProps } from "react";
import {
  Caption,
  Section as TguiSection,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import { usePlatformOrBase } from "@/hooks/usePlatform";
import styles from "./Section.module.css";

/**
 * Секция с заголовком по умолчанию `h2`.
 *
 * Кит зашивает `Component: "h1"` в SectionHeader, и переопределить его
 * пропом нельзя: страница из нескольких секций получала бы по `h1` на
 * заголовок, при том что NavHeader помечен aria-hidden («авторитетные
 * h1 живут на страницах»).
 *
 * Обход узлом теряет обёртку `<header>` с геометрией и цветом заголовка
 * (padding 20px 24px 4px 22px / на iOS 16px 16px 8px). Поэтому здесь
 * своя обёртка с теми же значениями, а типографика повторяет рецепт
 * самого кита (useHeaderComponents): iOS — `Caption caps` (13px),
 * остальное — `Subheadline level=2 weight=2` (15px/600).
 * Паритет закреплён kitContract.test.tsx.
 *
 * Платформа берётся из контекста AppRoot (usePlatformOrBase) — того же, что
 * читает ui/Sheet, так что расхождение с тем, что AppRoot передал, невозможно.
 * Фолбэк 'base', а не исключение: вне AppRoot китовой Section тоже рисуется
 * нейтрально, и заголовок секции не должен ронять рендер страницы.
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
  const platform = usePlatformOrBase();

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
