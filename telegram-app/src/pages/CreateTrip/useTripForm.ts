import { useMemo, useReducer, useState } from "react";
import { MAX_SEATS, type TripTag } from "@edem/contracts";
import type { CreateTripDraft } from "@/helpers/createTripForm";
import { toLocalDateTimeInputValue } from "@/utils/date";

const tomorrow = () =>
  toLocalDateTimeInputValue(new Date(Date.now() + 86_400_000));

/**
 * Состояние формы создания поездки (10 полей). Города хранятся как id
 * справочника, а не именами: имя неоднозначно («Москва» входит в «Москва-…»),
 * и резолвить его обратно в id при отправке — источник рассинхрона.
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
}

export type TripFormField = keyof TripFormState;

/** Начальные значения — те же, что были в useState страницы. */
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
  | { type: "toggleTag"; tag: TripTag }
  | { type: "stepSeats"; delta: 1 | -1 };

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
    case "stepSeats": {
      const next = Number(state.seats);
      const base = Number.isFinite(next) ? Math.trunc(next) : 1;
      return {
        ...state,
        seats: String(Math.min(MAX_SEATS, Math.max(1, base + action.delta))),
      };
    }
  }
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

  const isDirty = useMemo(
    () =>
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
      form.tags.length > 0,
    [form, initial],
  );

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
    stepSeats: (delta: 1 | -1) => dispatch({ type: "stepSeats", delta }),
  };
}

export type TripForm = ReturnType<typeof useTripForm>;
