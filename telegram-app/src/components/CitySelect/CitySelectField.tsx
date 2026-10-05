import { Select } from "@telegram-apps/telegram-ui";
import { haptic } from "@/utils/haptics";
import { Field } from "@/ui/Field";
import styles from "./CitySelectField.module.css";

/**
 * Выбор города на нативном tgui Select (обычный <select>) — ЕДИНСТВЕННЫЙ
 * способ выбора города в приложении (решение владельца 2026-10-03).
 *
 * ПОЧЕМУ ИМЕННО SELECT, А НЕ КОМБОБОКС. Нативный `<select>` даёт всё, что
 * нужно, бесплатно и без своего кода: настоящие `<option>` (замер: 32 штуки
 * с `role=option` и `aria-selected`), системный пикер на iOS/Android — в
 * Telegram Webview это уместнее самописного выпадающего списка — и
 * SSR-безопасность (renderToString без сайд-эффектов). Свой комбобокс
 * потребовался бы только ради поиска по подстроке, а он на региональном
 * справочнике не нужен.
 *
 * ЧЕГО ЭТО НЕ ДЕЛАЕТ (осознанно): поиска по подстроке нет. Если справочник
 * дорастёт до сотен городов, нативный пикер станет неудобен — тогда возвращаемся
 * к вопросу отдельной задачей, а не переписываем сейчас.
 *
 * ЗАЧЕМ НАРОДНЫЙ, А НЕ КИТОВСКИЙ `Multiselect` (реестр #19): у китовского
 * мультиселекта 32 пункта без `role=option`, без `aria-selected` и без `id`
 * (замер 2026-10-03), плюс он трогает `document` через `useGlobalClicks` и
 * потому не годится для `renderToString`. Нативный `<select>` этих проблем
 * не имеет по построению.
 *
 * ЗНАЧЕНИЕ — ID справочника, а не имя (то же решение владельца): поиск по
 * имени неоднозначен, «Москва» входит в «Москва-…».
 */
interface CitySelectFieldProps {
  id: string;
  label: string;
  /** Выбранный город по id справочника; пустая строка — ничего не выбрано. */
  valueId: string;
  cities: readonly { id: string; name: string }[] | undefined;
  placeholder: string;
  onChange: (cityId: string) => void;
  /** Город-партнёр по id: исключается из списка (уже выбран другим полем). */
  excludeId?: string;
  /** Ошибка поля: aria-invalid + aria-describedby + текст (Field умеет). */
  error?: string | null;
  disabled?: boolean;
}

export function CitySelectField({
  id,
  label,
  valueId,
  cities,
  placeholder,
  onChange,
  excludeId,
  error,
  disabled = false,
}: CitySelectFieldProps) {
  // Подпись: Field даёт скрытый label (имя для скринридера на всех
  // платформах) и header на контрол — видимую подпись base; связка
  // htmlFor+id держит e2e getByLabel (канон вместо локальной копии).
  return (
    <Field label={label} id={id} className={styles.field} error={error}>
      {(field) => (
        <Select
          {...field}
          className={styles.select}
          disabled={disabled}
          value={valueId}
          onChange={(event) => {
            haptic.selection();
            onChange(event.target.value);
          }}
        >
          <option value="" disabled hidden>
            {placeholder}
          </option>
          {cities
            ?.filter((city) => !excludeId || city.id !== excludeId)
            .map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
        </Select>
      )}
    </Field>
  );
}
