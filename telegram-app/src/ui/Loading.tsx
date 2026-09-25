import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";

/**
 * Полноэкранная загрузка без скелетона: спиннер + необязательная подпись.
 *
 * Одна роль на всё приложение (было: сырой `Placeholder` + `Spinner` в
 * CreateTripPage): `role="status"` + `aria-label="Загрузка"` гарантирует
 * сам примитив, поэтому объявление для скринридера не «забывается» на
 * новом экране. Когда форма/лента имеет скелетон — используется
 * `QueryState` со `skeleton` (это его ветка), `Loading` — только для
 * «страница ещё не может отрисоваться» (гейты справочников/прав).
 */
export function Loading({ label }: { label?: string }) {
  return (
    <Placeholder>
      <span role="status" aria-label="Загрузка">
        <Spinner size="m" />
      </span>
      {label && <>{label}</>}
    </Placeholder>
  );
}
