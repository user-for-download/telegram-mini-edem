import { Select } from "@telegram-apps/telegram-ui";
import { haptic } from "@/utils/haptics";
import { Field } from "@/ui/Field";
import styles from "./CitySelectField.module.css";

/**
 * Выбор города на нативном tgui Select (обычный <select>) — ЕДИНСТВЕННЫЙ
 * способ выбора города в приложении.
 *
 * Нативный `<select>` даёт всё нужное бесплатно и без своего кода:
 * настоящие `<option>`, системный пикер на iOS/Android (в Telegram
 * Webview уместнее самописного выпадающего списка) и SSR-безопасность
 * (renderToString без сайд-эффектов). Свой комбобокс потребовался бы
 * только ради поиска по подстроке, а он на региональном справочнике
 * не нужен.
 *
 * Поиска по подстроке нет осознанно: если справочник дорастёт до сотен
 * городов, нативный пикер станет неудобен — тогда возвращаемся к вопросу
 * отдельной задачей, а не переписываем сейчас.
 *
 * Китовский `Multiselect` не подходит (реестр #19): его пункты без
 * `role=option`/`aria-selected`/`id`, плюс он трогает `document` через
 * `useGlobalClicks` и не годится для `renderToString`.
 *
 * ЗНАЧЕНИЕ — ID справочника, а не имя: поиск по имени неоднозначен,
 * «Москва» входит в «Москва-…».
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
  /**
   * Город обязателен по контракту (createTripDtoSchema: fromCityId/toCityId —
   * uuid без .optional()). Опция, а не постоянное поведение: справочник
   * используется и как фильтр (главная, поиск, заявка на попутку), где
   * город можно не выбирать. Свободный ввод при этом по-прежнему невозможен —
   * обязательность меняет только объявление, а не набор `<option>`.
   */
  required?: boolean;
  /** Компактное поле (поиск/фильтры): ~50px вместо 84px, см. ui/Field. */
  compact?: boolean;
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
  required = false,
  compact = false,
}: CitySelectFieldProps) {
  // Подпись: Field даёт скрытый label (имя для скринридера на всех
  // платформах) и header на контрол — видимую подпись base; связка
  // htmlFor+id держит e2e getByLabel (канон вместо локальной копии).
  //
  // required + aria-required рядом: китовский Select спредит остальные пропы на
  // нативный <select> (Select.js → Text/Subheadline → Typography), поэтому
  // атрибут доезжает до DOM без обёрток. Дублируем явно, потому что здесь
  // атрибут СТАТИЧЕН и разойтись ему не с чем — в отличие от aria-checked у
  // Switch (MEMORY.md §18), который выводит браузер из меняющегося checked.
  return (
    <Field
      label={label}
      id={id}
      className={styles.field}
      compact={compact}
      error={error}
    >
      {(field) => (
        <Select
          {...field}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          value={valueId}
          onChange={(event) => {
            haptic.selection();
            onChange(event.target.value);
          }}
        >
          <option value="" disabled={required} hidden={required}>
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
