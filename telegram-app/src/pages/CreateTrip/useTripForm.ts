import { useMemo, useReducer, useState } from "react";
import type { TripTag } from "@edem/contracts";
import type { CreateTripDraft } from "@/helpers/createTripForm";
import { toLocalDateTimeInputValue } from "@/utils/date";

const tomorrow = () =>
  toLocalDateTimeInputValue(new Date(Date.now() + 86_400_000));

/**
 * Состояние формы создания поездки. Города хранятся как id справочника,
 * а не именами: имя неоднозначно («Москва» входит в «Москва-…»), и резолвить
 * его обратно в id при отправке — источник рассинхрона.
 */
export interface TripFormState {
  /** id городов справочника (не имена). */
  fromCityId: string;
  toCityId: string;
  fromAddress: string;
  toAddress: string;
  /** datetime-local значение. */
  date: string;
  durationHours: string;
  distanceKm: string;
  price: string;
  seats: string;
  comment: string;
  tags: TripTag[];
  /** Завершать поездку сразу по окончании рейса (иначе — текущие +24ч). */
  autoComplete: boolean;
  /** Предлагать подходящие ride request (выключено — не предлагать вовсе). */
  matchingEnabled: boolean;
}

export type TripFormField = keyof TripFormState;

/**
 * Начальные значения — те же, что были в useState страницы.
 *
 * Флаги опций равны дефолтам `createTripDtoSchema` (autoComplete=false,
 * matchingEnabled=true): форма стартует в состоянии, эквивалентном текущему
 * поведению бэкенда (автозавершение по TTL +24ч, безусловный подбор пассажиров),
 * поэтому старый/новый клиент и e2e-фикстуры дают одинаковую поездку.
 */
export function initialTripFormState(): TripFormState {
  return {
    fromCityId: "",
    toCityId: "",
    fromAddress: "",
    toAddress: "",
    date: tomorrow().slice(0, 16),
    durationHours: "1",
    distanceKm: "",
    price: "500",
    seats: "1",
    comment: "",
    tags: [],
    autoComplete: false,
    matchingEnabled: true,
  };
}

export type TripFormAction =
  | {
      [K in TripFormField]: {
        type: "set";
        field: K;
        value: TripFormState[K];
      };
    }[TripFormField]
  | { type: "swapCities" }
  | { type: "toggleTag"; tag: TripTag };

/**
 * Чистый редьюсер формы (ради unit-тестов инвариантов без DOM).
 * Сайд-эффекты (haptic, гашение ошибок) остаются в странице.
 */
export function tripFormReducer(
  state: TripFormState,
  action: TripFormAction,
): TripFormState {
  switch (action.type) {
    case "set":
      return state[action.field] === action.value
        ? state
        : ({ ...state, [action.field]: action.value } as TripFormState);
    case "swapCities":
      return {
        ...state,
        fromCityId: state.toCityId,
        toCityId: state.fromCityId,
        fromAddress: state.toAddress,
        toAddress: state.fromAddress,
      };
    case "toggleTag":
      return {
        ...state,
        tags: state.tags.includes(action.tag)
          ? state.tags.filter((item) => item !== action.tag)
          : [...state.tags, action.tag].slice(0, 6),
      };
  }
}

/**
 * Несохранённый черновик: форма отличается от начальных значений.
 *
 * Вынесено чистой функцией ради unit-теста без DOM. Флаги опций участвуют
 * в сравнении наравне с полями ввода: переключатель — тоже выбор водителя,
 * и без этого сравнения Telegram не спросил бы подтверждение ухода, а водитель
 * потерял бы выбор молча (ровно как сегодня теряет комментарий).
 */
export function isTripFormDirty(
  form: TripFormState,
  initial: TripFormState,
): boolean {
  return (
    form.fromCityId !== initial.fromCityId ||
    form.toCityId !== initial.toCityId ||
    form.fromAddress !== initial.fromAddress ||
    form.toAddress !== initial.toAddress ||
    form.date !== initial.date ||
    form.durationHours !== initial.durationHours ||
    form.distanceKm !== initial.distanceKm ||
    form.price !== initial.price ||
    form.seats !== initial.seats ||
    form.comment !== initial.comment ||
    form.tags.length > 0 ||
    form.autoComplete !== initial.autoComplete ||
    form.matchingEnabled !== initial.matchingEnabled
  );
}

/**
 * Форма создания поездки на useReducer + isDirty из сравнения
 * с начальными значениями (несохранённый черновик для
 * useClosingConfirmation). UI-флаги (vehicleOpen/validationError/
 * errorField) остаются в useState страницы.
 */
export function useTripForm() {
  // Снимок начальных значений на момент монтирования: date фиксируется
  // один раз.
  const [initial] = useState(initialTripFormState);
  const [form, dispatch] = useReducer(tripFormReducer, initial);

  const setField = <K extends TripFormField>(
    field: K,
    value: TripFormState[K],
  ) =>
    dispatch({ type: "set", field, value } as TripFormAction);

  const isDirty = useMemo(() => isTripFormDirty(form, initial), [form, initial]);

  /** Черновик для validateCreateTripDraft (порядок полей — как в форме). */
  const draft: CreateTripDraft = useMemo(
    () => ({
      fromCityId: form.fromCityId,
      toCityId: form.toCityId,
      fromAddress: form.fromAddress,
      toAddress: form.toAddress,
      date: form.date,
      durationHours: form.durationHours,
      distanceKm: form.distanceKm,
      price: form.price,
      seats: form.seats,
      tags: form.tags,
      comment: form.comment,
      autoComplete: form.autoComplete,
      matchingEnabled: form.matchingEnabled,
    }),
    [form],
  );

  return {
    form,
    draft,
    isDirty,
    setField,
    swapCities: () => dispatch({ type: "swapCities" }),
    toggleTag: (tag: TripTag) => dispatch({ type: "toggleTag", tag }),
  };
}

export type TripForm = ReturnType<typeof useTripForm>;
