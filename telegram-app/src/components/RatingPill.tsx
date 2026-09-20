import { Star } from "lucide-react";
import styles from "./RatingPill.module.css";

interface RatingPillProps {
  /** Значение рейтинга 0…5, null — ещё нет оценок. */
  value: number | null;
  /** Размер пилюли. */
  size?: "m" | "s";
}

/**
 * Пилюля рейтинга «★ 4.9»: звезда lucide, десятичный разделитель — точка,
 * null — прочерк. Фон и текст — из переменных темы UI-кита.
 */
export function RatingPill({ value, size = "m" }: RatingPillProps) {
  const clamped = value == null ? null : Math.min(5, Math.max(0, value));
  const label =
    clamped == null ? "Рейтинг пока отсутствует" : `Рейтинг ${clamped.toFixed(1)} из 5`;

  return (
    <span
      className={`${styles.pill} ${size === "s" ? styles.small : ""}`}
      aria-label={label}
    >
      <span className={styles.star} aria-hidden="true">
        <Star size={size === "s" ? 12 : 14} fill="currentColor" strokeWidth={0} />
      </span>
      <span>{clamped == null ? "—" : clamped.toFixed(1)}</span>
    </span>
  );
}
