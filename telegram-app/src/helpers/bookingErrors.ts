// telegram-app/src/helpers/bookingErrors.ts
// Единый словарь ошибок броней/поездок:
// конфликт мест, пересечение броней, уехавшие поездки, авторизация, офлайн.
// Бэкенд — авторитет: маппим только его коды (backend/src/errors.ts,
// backend/src/trips/errors.ts), тексты — RU для UI.
import { isAccountDeletedError, ApiError } from "@/api/client";

const CODE_MESSAGES: Record<string, string> = {
  SEAT_TAKEN: "Место только что заняли — выберите другое",
  ALREADY_BOOKED: "У вас уже есть заявка на эту поездку",
  PASSENGER_BOOKING_OVERLAP:
    "Время пересекается с другой вашей бронью — проверьте «Мои брони»",
  TRIP_IN_PAST: "Поездка уже отправилась — бронирование недоступно",
  TRIP_NOT_ACTIVE: "Поездка недоступна для бронирования",
  DRIVER_TRIP_OVERLAP: "Время пересекается с другой вашей поездкой",
  FORBIDDEN: "Нет доступа: действие доступно только водителю или участнику",
  VALIDATION_FAILED: "Проверьте данные: сервер отклонил запрос",
  RATE_LIMITED: "Слишком много попыток — подождите и повторите",
  CONFLICT: "Данные только что изменились — обновите и повторите",
  REQUEST_TIMEOUT: "Превышено время ожидания — проверьте соединение",
  // Сервер ответил не по контракту (битый/неполный payload, не-JSON на
  // успешный статус). Раньше код не был в словаре, и в UI уезжал сырой
  // английский message ApiError ("Invalid server response").
  INVALID_RESPONSE: "Сервер вернул неожиданный ответ — обновите и повторите",
};

/**
 * Текст ошибки по коду — ТОЛЬКО собственные ключи словаря.
 *
 * `error.code` приходит из тела ответа бэкенда. Прямая индексация
 * объектного литерала опасна: `CODE_MESSAGES["toString"]`,
 * `["constructor"]`, `["__proto__"]` разрешаются в унаследованные члены
 * Object.prototype — это не строки, и такое значение роняет рендер
 * («Functions are not valid as a React child»). Типы этого не ловят,
 * поэтому проверяем и собственность ключа, и тип значения.
 */
function codeMessage(code: string): string | undefined {
  if (!Object.hasOwn(CODE_MESSAGES, code)) return undefined;
  const message: unknown = Reflect.get(CODE_MESSAGES, code);
  return typeof message === "string" ? message : undefined;
}

export function bookingErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403 && isAccountDeletedError(error)) {
      return "Профиль удалён — действие недоступно";
    }
    if (error.code) {
      if (error.code === "RATE_LIMITED" && error.retryAfterMs) {
        const seconds = Math.ceil(error.retryAfterMs / 1000);
        return `Слишком много попыток — повторите через ${seconds} с`;
      }
      const message = codeMessage(error.code);
      if (message !== undefined) return message;
    }
    if (error.status === 401) {
      return "Сессия истекла — перезапустите приложение";
    }
    if (error.status === 403) {
      return "Нет доступа: действие доступно только водителю или участнику";
    }
    if (error.status === 404) {
      return "Поездка не найдена — возможно, её удалили";
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось выполнить действие — проверьте соединение и повторите";
}

export function isAuthorizationError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403 || error.code === "FORBIDDEN")
  );
}
