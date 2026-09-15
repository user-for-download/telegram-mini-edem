import { createTripDtoSchema, type TripTag } from "@edem/contracts";
import type { z } from "zod";

/** Payload POST /trips — тип из схемы (бэкенд — авторитет). */
export type CreateTripPayload = z.infer<typeof createTripDtoSchema>;

/**
 * Черновик формы создания поездки (строковые поля ввода + теги).
 * Чистый хелпер ради unit-тестов инвариантов без DOM.
 */
export interface CreateTripDraft {
  fromName: string;
  toName: string;
  fromAddress: string;
  toAddress: string;
  /** datetime-local значение. */
  date: string;
  durationHours: string;
  distanceKm: string;
  price: string;
  seats: string;
  tags: TripTag[];
  comment: string;
}

export interface DirectoryCity {
  id: string;
  name: string;
}

export type CreateTripValidation =
  | { ok: true; data: CreateTripPayload }
  /** field — id инпута для подсветки status="error" и скролла; null — общая ошибка. */
  | { ok: false; error: string; field: string | null };

/** Русские тексты ошибок схемы по первому issue (свои message есть только у refine). */
function schemaErrorMessage(path: readonly (string | number | symbol)[]): {
  error: string;
  field: string | null;
} {
  const key = String(path[0] ?? "");
  switch (key) {
    case "durationMinutes":
      return { error: "Время в пути — от 1 до 168 часов", field: "create-duration" };
    case "distanceKm":
      return { error: "Укажите расстояние — от 1 до 20000 км", field: "create-distance" };
    case "price":
      return { error: "Укажите цену — от 1 до 100000 ₽", field: "create-price" };
    case "seatsTotal":
      return { error: "Мест может быть от 1 до 3", field: "create-seats" };
    case "fromAddress":
      return { error: "Адрес отправления — не длиннее 200 символов", field: "create-from-address" };
    case "toAddress":
      return { error: "Адрес назначения — не длиннее 200 символов", field: "create-to-address" };
    case "comment":
      return { error: "Комментарий — не длиннее 500 символов", field: "create-comment" };
    case "tags":
      return { error: "Условий поездки — не больше 6", field: null };
    case "fromCity":
    case "toCity":
    case "fromCityId":
    case "toCityId":
      return { error: "Города отправления и назначения совпадают", field: "create-to" };
    default:
      return { error: "Проверьте данные поездки", field: null };
  }
}

/**
 * Валидация черновика перед POST /trips (порядок как в форме):
 * 1. оба города — из справочника (свободный ввод запрещён);
 * 2. дата отправления — в будущем;
 * 3. полный payload — через createTripDtoSchema (бэкенд — авторитет:
 *    MAX_SEATS=3, fromCityId !== toCityId, лимиты цены/дистанции).
 */
export function validateCreateTripDraft(
  draft: CreateTripDraft,
  cities: readonly DirectoryCity[] | undefined,
  now: Date = new Date(),
): CreateTripValidation {
  const fromCity = cities?.find((city) => city.name === draft.fromName);
  const toCity = cities?.find((city) => city.name === draft.toName);
  if (!fromCity || !toCity) {
    return {
      ok: false,
      error: "Выберите города из справочника",
      field: !fromCity ? "create-from" : "create-to",
    };
  }
  const departureAt = new Date(draft.date);
  if (!Number.isFinite(departureAt.getTime()) || departureAt <= now) {
    return {
      ok: false,
      error: "Укажите будущие дату и время отправления",
      field: "create-date",
    };
  }
  const parsed = createTripDtoSchema.safeParse({
    fromCity: fromCity.name,
    toCity: toCity.name,
    fromCityId: fromCity.id,
    toCityId: toCity.id,
    fromAddress: draft.fromAddress.trim(),
    toAddress: draft.toAddress.trim(),
    departureAt: departureAt.toISOString(),
    durationMinutes: Number(draft.durationHours) * 60,
    distanceKm: Number(draft.distanceKm),
    price: Number(draft.price),
    seatsTotal: Number(draft.seats),
    tags: draft.tags,
    comment: draft.comment.trim() || undefined,
  });
  if (!parsed.success) {
    const first = schemaErrorMessage(parsed.error.issues[0]?.path ?? []);
    return { ok: false, error: first.error, field: first.field };
  }
  return { ok: true, data: parsed.data };
}
