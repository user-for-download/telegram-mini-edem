import { Input, Select } from "@telegram-apps/telegram-ui";
import { Calendar } from "lucide-react";
import { MAX_SEATS } from "@edem/contracts";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";
import { HINT } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { haptic } from "@/utils/haptics";
import type { RideRequestDraft } from "./rideRequestValidation";

/**
 * Поля формы запроса попутчика — вынесены из `RideRequestCreateForm`.
 *
 * Только разметка и значения: проверку и публикацию держит хост формы.
 * Ошибка приходит по id поля (`errorFor`), чтобы `<Field>` поставил
 * aria-invalid и aria-describedby на нужный контрол.
 *
 * Даты — в столбик, а не вдвое: нативный datetime-local рисует локальный
 * формат (в Telegram это mm/dd/yy), и в две колонки поле не влезало —
 * значение обрезалось.
 */
export function RideRequestFields({
  cities,
  values,
  errorFor,
  onChange,
}: {
  cities: readonly { id: string; name: string }[] | undefined;
  values: RideRequestDraft;
  errorFor: (id: string) => string | undefined;
  onChange: (values: RideRequestDraft) => void;
}) {
  const set = <K extends keyof RideRequestDraft>(
    field: K,
    value: RideRequestDraft[K],
  ) => onChange({ ...values, [field]: value });

  return (
    <>
      {/* Выбор города — тот же CitySelectField, что на главной, в поиске и
          форме создания. */}
      <CitySelectField
        id="ride-from"
        label="Откуда"
        valueId={values.fromCityId}
        cities={cities}
        placeholder="Город отправления"
        excludeId={values.toCityId}
        onChange={(value) => set("fromCityId", value)}
        error={errorFor("ride-from")}
      />
      <CitySelectField
        id="ride-to"
        label="Куда"
        valueId={values.toCityId}
        cities={cities}
        placeholder="Город назначения"
        excludeId={values.fromCityId}
        onChange={(value) => set("toCityId", value)}
        error={errorFor("ride-to")}
      />
      <Field
        label="Не раньше"
        id="ride-earliest"
        error={errorFor("ride-earliest")}
      >
        {(field) => (
          <Input
            {...field}
            before={<Calendar size={16} className={HINT} />}
            type="datetime-local"
            value={values.earliest}
            onChange={(event) => set("earliest", event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Не позже"
        id="ride-latest"
        error={errorFor("ride-latest")}
      >
        {(field) => (
          <Input
            {...field}
            before={<Calendar size={16} className={HINT} />}
            type="datetime-local"
            value={values.latest}
            onChange={(event) => set("latest", event.target.value)}
          />
        )}
      </Field>
      {/* Места — селект 1..MAX_SEATS, а не number-ввод: у number на iOS
          вылезают крутилки, а вариантов ровно столько, сколько в контракте
          (max = MAX_SEATS), — выбрать их быстрее, чем набрать. Тот же приём,
          что в форме создания поездки. */}
      <Field label="Места" id="ride-seats" error={errorFor("ride-seats")}>
        {(field) => (
          <Select
            {...field}
            value={values.seats}
            onChange={(event) => {
              haptic.selection();
              set("seats", event.target.value);
            }}
          >
            {Array.from({ length: MAX_SEATS }, (_, index) => (
              <option key={index + 1} value={String(index + 1)}>
                {index + 1}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}
