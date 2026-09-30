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
