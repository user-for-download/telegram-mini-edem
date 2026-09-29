import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import styles from "./ui.module.css";

/**
 * Полноэкранная загрузка без скелетона: спиннер + необязательная подпись.
 *
 * Одна роль на всё приложение (было: сырой `Placeholder` + `Spinner` в
 * CreateTripPage): `role="status"` + доступное имя гарантирует сам
 * примитив, поэтому объявление для скринридера не «забывается» на новом
 * экране. Подпись лежит ВНУТРИ статус-узла: `aria-label` берётся из неё
 * (или дефолт «Загрузка»), отдельного текста вне live-region нет.
 *
 * Когда форма/лента имеет скелетон — используется
 * `QueryState` со `skeleton` (это его ветка), `Loading` — только для
 * «страница ещё не может отрисоваться» (гейты справочников/прав).
 */
export function Loading({ label }: { label?: string }) {
  return (
    <Placeholder>
      <span
        role="status"
        aria-label={label ?? "Загрузка"}
        className={styles.loadingStatus}
      >
        <Spinner size="m" />
        {label}
      </span>
    </Placeholder>
  );
}
