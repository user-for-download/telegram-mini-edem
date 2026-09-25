import type { ComponentProps } from "react";
import { Chip as TguiChip } from "@telegram-apps/telegram-ui";
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

export interface ChipProps
  extends Omit<ComponentProps<typeof TguiChip>, "mode" | "variant"> {
  variant?: ChipVariant;
  tone?: ChipTone;
}

/**
 * Единая чип-кнопка (сессия .tmp/sessions/2026-09-25-ui-canon-parity, K2).
 *
 * Прямой китовый `Chip` использовался в 4 файлах (16 мест), а рецепт
 * выбранного тега продублировался тремя модулями CSS — здесь он один
 * (см. Chip.module.css). Пропсы кита (Component, type, href, before,
 * aria-pressed, onClick, disabled, className) прокидываются без изменений.
 */
export function Chip({
  variant = "quiet",
  tone = "neutral",
  className,
  ...restProps
}: ChipProps) {
  const merged = [
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
      {...restProps}
    />
  );
}
