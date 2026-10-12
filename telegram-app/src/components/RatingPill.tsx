import { Star } from "lucide-react";
import { Chip as TguiChip } from "@telegram-apps/telegram-ui";
import { hasRating } from "@/helpers/rating";
import styles from "./RatingPill.module.css";

interface RatingPillProps {
  /** Значение рейтинга 0…5. */
  value: number | null;
  /**
   * Сколько отзывов за оценкой. Нужен, чтобы отличить ОТСУТСТВИЕ рейтинга
   * от его значения: контракт отдаёт `rating` обязательным (`min(0).max(5)`),
   * поэтому ветка `value == null` из API недостижима, а «рейтинга нет»
   * приходит как ЧИСЛО:
   *   - 5.0 — новый пользователь (`auth/index.ts` создаёт rating: 5),
   *     у которого ноль отзывов: без проверки он светился бы идеальной
   *     оценкой при пустом профиле;
   *   - 0.0 — `recomputeUserRating` обнуляет, когда опубликованных отзывов
   *     не осталось (например, админ удалил последний).
   * Оба значения при `reviewsCount === 0` показываем прочерком.
   */
  reviewsCount?: number | null;
  /** Размер пилюли. */
  size?: "m" | "s";
}

/**
 * Пилюля рейтинга «★ 4.9» на нативном `Chip` кита (mode mono, Component span):
 * звезда lucide в слоте before, десятичный разделитель — точка,
 * нет оценки — прочерк. Фон и текст — из переменных темы UI-кита.
 */
export function RatingPill({
  value,
  reviewsCount,
  size = "m",
}: RatingPillProps) {
  const clamped = hasRating(value, reviewsCount)
    ? Math.min(5, Math.max(0, value as number))
    : null;
  const label =
    clamped == null
      ? "Рейтинг пока отсутствует"
      : `Рейтинг ${clamped.toFixed(1)} из 5`;

  return (
    <TguiChip
      Component="span"
      mode="mono"
      before={
        <span className={styles.star} aria-hidden="true">
          <Star
            size={size === "s" ? 12 : 14}
            fill="currentColor"
            strokeWidth={0}
          />
        </span>
      }
      className={`${styles.pill} ${size === "s" ? styles.small : ""}`}
      aria-label={label}
    >
      {clamped == null ? "—" : clamped.toFixed(1)}
    </TguiChip>
  );
}
