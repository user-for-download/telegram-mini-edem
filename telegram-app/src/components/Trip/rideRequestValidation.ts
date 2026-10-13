/**
 * Чистая валидация и сборка запроса попутчика из полей формы (DOM-free,
 * unit-тест без jsdom — паттерн reportValidation/reviewValidation).
 * Тексты русские: zod-сообщения схемы (`latestAt must be after earliestAt`)
 * пользователю не показываем.
 */
import {
  createRideRequestDtoSchema,
  type CreateRideRequestDto,
} from "@edem/contracts";
import type { DirectoryCity } from "@/helpers/createTripForm";
import { fromMoscowDateTimeInput } from "@/utils/date";

/**
 * Черновик формы: строковые значения полей (datetime-local, id городов).
 *
 * Одно состояние вместо пяти useState — набор полей меняется только при
 * добавлении поля в форму, а не в каждом обработчике.
 */
export interface RideRequestDraft {
  /** id городов справочника, не имена. */
  fromCityId: string;
  toCityId: string;
  earliest: string;
  latest: string;
  seats: string;
}

/**
 * Начальный черновик. Объект общий и НЕ мутируется: сброс — это спред
 * поверх текущего (места после публикации сохраняются).
 */
export const EMPTY_RIDE_REQUEST_DRAFT: RideRequestDraft = {
  fromCityId: "",
  toCityId: "",
  earliest: "",
  latest: "",
  seats: "1",
};

export type RideRequestDraftResult =
  | {
      ok: true;
      dto: CreateRideRequestDto;
      /** «Вологда → Тула» — для тоста и для текста предпроверки. */
      routeLabel: string;
    }
  | { ok: false; error: RideRequestFieldError };

/**
 * Черновик → DTO запроса, либо первая ошибка в порядке формы.
 *
 * Порядок обязателен и повторяет прежний: справочник → окно → разные города
 * → схема. Zod отвечает английским message, пользователю показываем русский
 * текст, поэтому схема идёт последней — её issue переводится
 * `rideRequestErrorMessage`.
 */
export function buildRideRequestDraft(
  draft: RideRequestDraft,
  cities: readonly DirectoryCity[] | undefined,
): RideRequestDraftResult {
  const fromCity = cities?.find((city) => city.id === draft.fromCityId);
  const toCity = cities?.find((city) => city.id === draft.toCityId);
  if (!fromCity || !toCity) {
    return {
      ok: false,
      error: { field: null, message: "Выберите города из справочника" },
    };
  }
  const windowError = validateRideRequestWindow(draft.earliest, draft.latest);
  if (windowError) return { ok: false, error: { field: null, message: windowError } };
  if (fromCity.id === toCity.id) {
    return {
      ok: false,
      error: {
        field: null,
        message: "Города отправления и прибытия должны различаться",
      },
    };
  }
  // Строки datetime-local — стенное время ПО МОСКВЕ (пара к
  // toLocalDateTimeInputValue в форме): `new Date(value)` читал бы их в зоне
  // устройства, и окно уезжало бы на часы у клиента вне МСК. null после
  // validateRideRequestWindow выше недостижим, но тип честно ведёт к
  // «выберите интервал», а не к исключению toISOString на Invalid Date.
  const earliestDate = fromMoscowDateTimeInput(draft.earliest);
  const latestDate = fromMoscowDateTimeInput(draft.latest);
  if (earliestDate === null || latestDate === null) {
    return {
      ok: false,
      error: { field: null, message: "Выберите временной интервал" },
    };
  }
  const parsed = createRideRequestDtoSchema.safeParse({
    fromCityId: fromCity.id,
    toCityId: toCity.id,
    earliestAt: earliestDate.toISOString(),
    latestAt: latestDate.toISOString(),
    // Запрос живёт до конца окна «Не позже»: привязка к earliest гасила
    // бы его из выдачи в момент начала окна.
    expiresAt: latestDate.toISOString(),
    seats: Number(draft.seats),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: rideRequestErrorMessage(parsed.error.issues[0]?.path ?? []),
    };
  }
  return {
    ok: true,
    dto: parsed.data,
    routeLabel: `${fromCity.name} → ${toCity.name}`,
  };
}

/** Окно отправления корректно (обе даты валидны, «не позже» строго после «не раньше»).
 *
 * Разбор — ПО МОСКВЕ (`fromMoscowDateTimeInput`, пара к хелперу, которым
 * форма кладёт значения в поля): `new Date(value)` читал бы стенное время в
 * зоне устройства, и сравнение шло бы по сдвинутым моментам.
 */
export function validateRideRequestWindow(
  earliest: string,
  latest: string,
): string | null {
  const earliestDate = fromMoscowDateTimeInput(earliest);
  const latestDate = fromMoscowDateTimeInput(latest);
  if (earliestDate === null || latestDate === null) {
    return "Выберите временной интервал";
  }
  if (earliestDate >= latestDate) {
    return "«Не позже» должно быть позже «Не раньше»";
  }
  return null;
}

/**
 * Перевод issue из DTO запроса в русский текст + id поля формы.
 *
 * Паттерн того же разбора, что `schemaErrorMessage` для поездок. Нужен
 * потому, что `min`/`max` на `<input type="number">` не запрещают ввод —
 * ограничивают только крутилки, — поэтому ветка zod достижима, и сырое
 * сообщение («Too big: expected number to be <=3») пользователю показывать
 * нельзя.
 *
 * Сообщения схемы записаны по-английски («Cities must be different»),
 * поэтому перевод не опционален.
 */
export interface RideRequestFieldError {
  /** id поля (`ride-from` / `ride-to` / `ride-seats` / `ride-edit-seats-<id>`). */
  field: string | null;
  message: string;
}

export function rideRequestErrorMessage(
  path: readonly (string | number | symbol)[],
  editRequestId?: string,
): RideRequestFieldError {
  const key = String(path[0] ?? "");
  switch (key) {
    case "seats":
      return {
        field: editRequestId ? `ride-edit-seats-${editRequestId}` : "ride-seats",
        message: "Мест может быть от 1 до 3",
      };
    case "fromCityId":
      return {
        field: editRequestId ? null : "ride-from",
        message: "Города отправления и прибытия должны различаться",
      };
    case "toCityId":
      return {
        field: editRequestId ? null : "ride-to",
        message: "Города отправления и прибытия должны различаться",
      };
    case "earliestAt":
      return {
        field: editRequestId ? `ride-edit-earliest-${editRequestId}` : "ride-earliest",
        message: "Выберите временной интервал",
      };
    case "latestAt":
      return {
        field: editRequestId ? `ride-edit-latest-${editRequestId}` : "ride-latest",
        message: "«Не позже» должно быть позже «Не раньше»",
      };
    case "expiresAt":
      return {
        field: null,
        message: "Срок действия запроса должен быть в будущем",
      };
    default:
      return { field: null, message: "Проверьте параметры запроса" };
  }
}

/** Минимальный срез заявки, нужный для проверки срока. */
interface ExpirableRequest {
  expiresAt: string;
}

/**
 * Истёк ли срок заявки.
 *
 * Статус `expired` не спасает: его пишет ТОЛЬКО сид — ни воркер, ни админский
 * маршрут этого не делают (проверено по backend/src). Поэтому просроченная
 * заявка навсегда остаётся `active`/`paused`, и UI обязан считать срок сам.
 *
 * Сервер это уже учитывает: возврат `active` из `paused` при
 * `expiresAt <= now` даёт 409 CONFLICT
 * (`rideRequests/index.ts`). Без этой проверки кнопка «Возобновить»
 * обещала действие, которое всегда отклонялось, и заявка становилась
 * недоступна через UI навсегда.
 *
 * Неразобранный `expiresAt` НЕ считаем истёкшим: тогда скрыли бы кнопку
 * у заявки, у которой срок просто не приехал.
 */
export function isRideRequestExpired(
  request: ExpirableRequest,
  now: Date = new Date(),
): boolean {
  const expiresAt = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= now.getTime();
}
