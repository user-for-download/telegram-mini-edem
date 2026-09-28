import { Caption } from "@telegram-apps/telegram-ui";
import styles from "./ui.module.css";

/**
 * Счётчик символов поля формы: «12/500», выравнивание вправо.
 * Без aria-live: скринридер ставит в очередь КАЖДОЕ изменение, так что
 * polite объявлял бы счётчик на каждый символ. Заменяет 4 копии
 * `.counter` (text-align: right) и самодельный `text-right` в AppealForm.
 */
export function CharCounter({ value, max }: { value: number; max: number }) {
  return (
    <Caption Component="p" className={styles.fieldCounter}>
      {value}/{max}
    </Caption>
  );
}
