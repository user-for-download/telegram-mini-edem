import { useId } from "react";
import { haptic } from "@/utils/haptics";
import styles from "./RatingInput.module.css";

export interface RatingInputProps {
  value: number;
  onChange: (value: number) => void;
  labelledBy?: string;
}

const OPTIONS = [1, 2, 3, 4, 5] as const;

/**
 * Оценка 1–5 — собственные нативные radio (tgui Rating не даёт
 * accessible name опциям: внутри label только SVG, скринридер слышит
 * «radio button, N of 6» без значения).
 * radiogroup-обёртка именуется через review-rating-label, каждая опция —
 * aria-label «Оценка N из 5»; клавиатура — нативные radio одного name
 * (стрелки/Tab), тач-таргеты 44px — CSS-модуль рядом. Вид — те же звёзды
 * (SVG в label), визуальное состояние — через :checked + :has в CSS.
 */
export function RatingInput({
  value,
  onChange,
  labelledBy = "review-rating-label",
}: RatingInputProps) {
  // Имя группы уникально на экземпляр: два RatingInput на одной странице
  // иначе сливаются в одну радиогруппу (нативный name-scope).
  const groupName = useId();

  const handleChange = (next: number): void => {
    haptic.selection();
    onChange(next);
  };

  return (
    <div className={styles.field} role="radiogroup" aria-labelledby={labelledBy}>
      {OPTIONS.map((option) => (
        <label key={option} className={styles.star}>
          <input
            type="radio"
            name={groupName}
            value={option}
            checked={value === option}
            onChange={() => handleChange(option)}
            aria-label={`Оценка ${option} из 5`}
            className={styles.input}
          />
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            className={styles.icon}
            data-active={value >= option}
          >
            <path
              fill="currentColor"
              d="M12 2.5l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.4l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.5z"
            />
          </svg>
        </label>
      ))}
    </div>
  );
}
