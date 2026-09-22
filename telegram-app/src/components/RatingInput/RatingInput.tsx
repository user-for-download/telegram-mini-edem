import { useEffect, useRef, useState } from "react";
import { Rating } from "@telegram-apps/telegram-ui";
import { haptic } from "@/utils/haptics";
import styles from "./RatingInput.module.css";

export interface RatingInputProps {
  value: number;
  onChange: (value: number) => void;
  labelledBy?: string;
}

/**
 * Оценка 1–5 на нативном tgui Rating (max 5, precision 1).
 * radiogroup-обёртка сохраняет именование через review-rating-label
 * (паритет со старым кастомным radiogroup), клавиатура — нативные radio
 * одного name (стрелки/Tab из коробки), тач-таргеты 44px — CSS-модуль рядом.
 * tgui Rating сеет внутреннее состояние один раз (defaultValue), поэтому
 * программный сброс (setRating(5) после отправки) требует remount через key.
 */
export function RatingInput({
  value,
  onChange,
  labelledBy = "review-rating-label",
}: RatingInputProps) {
  const [resetKey, setResetKey] = useState(0);
  const lastSent = useRef(value);

  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setResetKey((key) => key + 1);
    }
  }, [value]);

  const handleChange = (next: number): void => {
    lastSent.current = next;
    haptic.selection();
    onChange(next);
  };

  return (
    <div className={styles.field} role="radiogroup" aria-labelledby={labelledBy}>
      <Rating
        key={resetKey}
        value={value}
        onChange={handleChange}
        max={5}
        precision={1}
      />
    </div>
  );
}
