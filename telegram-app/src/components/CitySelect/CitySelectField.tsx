import { Select } from "@telegram-apps/telegram-ui";
import { haptic } from "@/utils/haptics";
import { Field } from "@/ui/Field";
import type { PickerCity } from "@/components/CityPicker/CityPickerField";
import styles from "./CitySelectField.module.css";

/**
 * Выбор города на нативном tgui Select (обычный <select>): тап открывает
 * системный дропдаун ОС — ввод с клавиатуры и «нажать Enter» не нужны
 * (в отличие от Multiselect в CityPickerField, где выбор — «напечатай и
 * выбери»). Значение для родителя — имя города, контракт тот же, что у
 * CityPickerField (onSelect(name)); внутри контролируется id.
 *
 * SSR-safe: нативный select рендерится в renderToString без side effects
 * (Multiselect трогает document через useGlobalClicks — здесь этого нет).
 * Пустое значение — disabled/hidden option с placeholder-текстом.
 */
interface CitySelectFieldProps {
  id: string;
  label: string;
  value: string;
  cities: readonly PickerCity[] | undefined;
  placeholder: string;
  onSelect: (name: string) => void;
  /** Город-партнёр: другой селект уже выбрал его — исключаем из списка. */
  exclude?: string;
}

export function CitySelectField({
  id,
  label,
  value,
  cities,
  placeholder,
  onSelect,
  exclude,
}: CitySelectFieldProps) {
  const selectedId = cities?.find((city) => city.name === value)?.id ?? "";

  // Подпись: Field даёт скрытый label (имя для скринридера на всех
  // платформах) и header на контрол — видимую подпись base; связка
  // htmlFor+id держит e2e getByLabel (канон вместо локальной копии).
  return (
    <Field label={label} id={id} className={styles.field}>
      {(field) => (
        <Select
          {...field}
          value={selectedId}
          onChange={(event) => {
            haptic.selection();
            const pickedId = event.target.value;
            onSelect(cities?.find((city) => city.id === pickedId)?.name ?? "");
          }}
        >
          <option value="" disabled hidden>
            {placeholder}
          </option>
          {cities
            ?.filter((city) => !exclude || city.name !== exclude)
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
