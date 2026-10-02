import type { ComponentProps } from "react";
import { Chip as TguiChip } from "@telegram-apps/telegram-ui";
import { AS_BUTTON } from "@/ui/classes";
import styles from "./Chip.module.css";

/**
 * Вид чипа → режимы кита (маппинг 1:1, как у ui/Button/ui/IconButton):
 *
 * - `quiet` (mono, по умолчанию) — нейтральная пилюля;
 * - `active` (elevated) — «поднятая»: чип-действие активно/фильтры открыты.
 */
export type ChipVariant = "quiet" | "active";

const MODES = {
  quiet: "mono",
  active: "elevated",
} as const;

/**
 * Тональность нажатого состояния:
 * - `neutral` (по умолчанию) — визуал меняет только `variant`;
 * - `accent` — выбранный тег горит синим (условия/особенности поездки).
 */
export type ChipTone = "neutral" | "accent";

export interface ChipProps extends Omit<
  ComponentProps<typeof TguiChip>,
  "mode" | "variant"
> {
  variant?: ChipVariant;
  tone?: ChipTone;
}

/**
 * Единая чип-кнопка.
 *
 * Прямой китовский `Chip` использовался в 4 файлах (16 мест), а рецепт
 * выбранного тега продублировался тремя модулями CSS — здесь он один
 * (см. Chip.module.css). Пропсы кита (Component, type, href, before,
 * aria-pressed, onClick, disabled, className) прокидываются без изменений.
 *
 * Кликабельный чип по умолчанию `<button>`. Кит без Component рендерит
 * `div`, а div с onClick/aria-pressed недоступен с клавиатуры и читается
 * скринридером как текст — ровно это было в фильтрах NotificationsPage и
 * TripActivePage (замер: tag=DIV, role=null, tabindex нет). Явный
 * Component всегда выигрывает: `Component="a" href` остаётся ссылкой.
 */
export function Chip({
  variant = "quiet",
  tone = "neutral",
  className,
  ...restProps
}: ChipProps) {
  // Интерактивность выводим из пропов кита: onClick/href делают чип
  // элементом управления, иначе он остаётся текстовой плашкой.
  const interactive =
    restProps.onClick !== undefined || restProps.href !== undefined;
  const component =
    restProps.Component ?? (interactive ? ("button" as const) : undefined);
  const type =
    restProps.type ??
    (component === "button" ? ("button" as const) : undefined);

  const merged = [
    // Сброс UA-кнопки: `Component="button"` (теги-фильтры в 4 местах) течёт
    // Arial/чёрным цветом/appearance:auto — кит этого не снимает. Подробности
    // и замер A/B — buttonReset.module.css. Для div-чипа класс no-op.
    AS_BUTTON,
    styles.chip,
    tone === "accent" ? styles.accent : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <TguiChip
      mode={MODES[variant]}
      className={merged || undefined}
      Component={component}
      type={type}
      {...restProps}
    />
  );
}
