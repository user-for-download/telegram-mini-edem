import { Star } from "lucide-react";
import { Chip as TguiChip } from "@telegram-apps/telegram-ui";
import styles from "./RatingPill.module.css";

interface RatingPillProps {
  /** Значение рейтинга 0…5, null — ещё нет оценок. */
  value: number | null;
  /** Размер пилюли. */
  size?: "m" | "s";
}

/**
 * Пилюля рейтинга «★ 4.9» на нативном `Chip` кита (mode mono, Component span):
 * звезда lucide в слоте before, десятичный разделитель — точка,
 * null — прочерк. Фон и текст — из переменных темы UI-кита.
 */
export function RatingPill({ value, size = "m" }: RatingPillProps) {
  const clamped = value == null ? null : Math.min(5, Math.max(0, value));
  const label =
    clamped == null ? "Рейтинг пока отсутствует" : `Рейтинг ${clamped.toFixed(1)} из 5`;

  return (
    <TguiChip
      Component="span"
      mode="mono"
      before={
        <span className={styles.star} aria-hidden="true">
          <Star size={size === "s" ? 12 : 14} fill="currentColor" strokeWidth={0} />
        </span>
      }
      className={`${styles.pill} ${size === "s" ? styles.small : ""}`}
      aria-label={label}
    >
      {clamped == null ? "—" : clamped.toFixed(1)}
    </TguiChip>
  );
}
