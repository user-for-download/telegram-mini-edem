// telegram-app/src/helpers/bookingErrors.ts
// Единый словарь ошибок броней/поездок (паритет VK TripDetailsPanel):
// конфликт мест, пересечение броней, уехавшие поездки, авторизация, офлайн.
// Бэкенд — авторитет: маппим только его коды (backend/src/errors.ts,
// backend/src/trips/errors.ts), тексты — RU для UI.
import { ApiError } from "@/api/client";

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
};

export function bookingErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && CODE_MESSAGES[error.code]) {
      if (error.code === "RATE_LIMITED" && error.retryAfterMs) {
        const seconds = Math.ceil(error.retryAfterMs / 1000);
        return `Слишком много попыток — повторите через ${seconds} с`;
      }
      return CODE_MESSAGES[error.code];
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
