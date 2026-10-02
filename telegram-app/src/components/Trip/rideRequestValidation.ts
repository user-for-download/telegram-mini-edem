/**
 * Чистая валидация окна «Не раньше / Не позже» запроса попутки (DOM-free,
 * unit-тест без jsdom — паттерн reportValidation/reviewValidation).
 * Тексты русские: zod-сообщения схемы (`latestAt must be after earliestAt`)
 * пользователю не показываем.
 */

/** Окно отправления корректно (обе даты валидны, «не позже» строго после «не раньше»). */
export function validateRideRequestWindow(
  earliest: string,
  latest: string,
): string | null {
  const earliestDate = new Date(earliest);
  const latestDate = new Date(latest);
  if (
    !Number.isFinite(earliestDate.getTime()) ||
    !Number.isFinite(latestDate.getTime())
  ) {
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
 * нельзя (замер 2026-10-02).
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
    case "toCityId":
      return {
        field: editRequestId ? null : "ride-to",
        message: "Города отправления и прибытия должны различаться",
      };
    case "earliestAt":
      return {
        field: editRequestId ? null : "ride-earliest",
        message: "Выберите временной интервал",
      };
    case "latestAt":
      return {
        field: editRequestId ? null : "ride-latest",
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
