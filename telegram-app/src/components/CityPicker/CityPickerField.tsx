import { useMemo } from "react";
import { Input, Multiselect } from "@telegram-apps/telegram-ui";
import { MapPin } from "lucide-react";
import { haptic } from "@/utils/haptics";
import { Field } from "@/ui/Field";
import styles from "./CityPickerField.module.css";

export interface PickerCity {
  id: string;
  name: string;
}

/** Опция списка (структурно совместима с MultiselectOption tgui). */
export interface CityOption {
  value: string;
  label: string;
}

/** Справочник БД → опции (value = id, label = имя). */
export function toCityOptions(
  cities: readonly PickerCity[] | undefined,
): CityOption[] {
  if (!cities) return [];
  return cities.map((city) => ({ value: city.id, label: city.name }));
}

/**
 * Выбранная опция по имени (max = 1): strict-lookup в справочнике.
 * Имя вне справочника (устаревшие данные) — пусто, выбор начинается заново.
 */
export function selectedCityOptions(
  cities: readonly PickerCity[] | undefined,
  value: string,
): CityOption[] {
  const found = cities?.find((city) => city.name === value);
  return found ? [{ value: found.id, label: found.name }] : [];
}

/**
 * max = 1: из picked берём последний (повторный выбор заменяет текущий);
 * пусто (снятие чипа крестиком/Backspace) → "" — то же снятие, что раньше
 * крестиком в after-слоте. creatable выключен: все picked из справочника,
 * имя резолвим по id.
 */
export function cityNameFromPicked(
  cities: readonly PickerCity[] | undefined,
  picked: ReadonlyArray<{ value: string | number; label?: unknown }>,
): string {
  const last = picked[picked.length - 1];
  if (!last) return "";
  return cities?.find((city) => city.id === String(last.value))?.name ?? "";
}

/**
 * Поле выбора города из справочника БД на нативном tgui Multiselect
 * (вместо кастомного дропдауна): печать фильтрует (дефолтный filterFn),
 * тап/Enter — выбирает, чип снимается. max = 1 — клампом в onChange
 * (у Multiselect нет max-пропа). creatable={false} осознанно: валидатор
 * createTripForm и бэкенд требуют город из справочника (fromCityId/
 * toCityId), свободный ввод запрещён. Значение для родителя — имя города
 * (контракт onSelect без изменений). SSR-safe: дропдаун по умолчанию закрыт.
 */
export function CityPickerField({
  id,
  label,
  value,
  cities,
  placeholder,
  status,
  error = null,
  onSelect,
}: {
  id: string;
  label: string;
  value: string;
  cities: readonly PickerCity[] | undefined;
  placeholder: string;
  status?: "default" | "error";
  /**
   * Текст ошибки поля. Прокидывается в `<Field error=…>`, который ставит
   * aria-invalid + aria-describedby (замер 2026-10-02: пока пропа не было, ни
   * одно из 10 полей формы поездки не было связано со своей ошибкой).
   */
  error?: string | null;
  onSelect: (name: string) => void;
}) {
  const options = useMemo(() => toCityOptions(cities), [cities]);
  const selected = useMemo(
    () => selectedCityOptions(cities, value),
    [cities, value],
  );

  // Multiselect трогает document при рендере (useGlobalClicks) — в SSR
  // (только тесты; прод — CSR, e2e — браузер) отдаём те же label/id/
  // placeholder/value на plain Input: тексты и связи для тестов те же.
  if (typeof document === "undefined") {
    return (
      <Field label={label} id={id} className={styles.field} error={error}>
        {(field) => (
          <Input
            {...field}
            before={<MapPin size={17} className={styles.pinInput} />}
            value={value}
            placeholder={placeholder}
            status={status}
            readOnly
          />
        )}
      </Field>
    );
  }

  // Подпись: Field даёт скрытый label (имя для скринридера на всех
  // платформах) и header на контрол — видимую подпись base (на iOS её нет);
  // связка htmlFor+id держит e2e getByLabel (канон вместо локальной копии).
  return (
    <Field label={label} id={id} className={styles.field} error={error}>
      {(field) => (
        <Multiselect
          {...field}
          before={<MapPin size={17} className={styles.pinSelect} />}
          options={options}
          value={selected}
          onChange={(picked) => {
            haptic.selection();
            onSelect(cityNameFromPicked(cities, picked.slice(-1)));
          }}
          placeholder={placeholder}
          // status отдаём только на ошибку: "default" глушил бы нативный
          // focused-стиль при открытом дропдауне (controlledStatus внутри).
          status={status === "error" ? "error" : undefined}
          creatable={false}
          closeDropdownAfterSelect
          emptyText="Нет таких городов в справочнике"
        />
      )}
    </Field>
  );
}
