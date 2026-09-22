import { ApiError } from "@/api/client";
import type { VehicleFormDto } from "@/api/vehicle";

/**
 * Чистая валидация/нормализация формы автомобиля (порт CarFormModal из
 * mini-app + backend carFormSchema). DOM-free модуль — покрыт unit-тестом
 * без jsdom, страница импортирует, тесты проверяют напрямую.
 *
 * Лимиты зеркалят backend (backend/src/users/index.ts):
 * model ≤ 50, color ≤ 30, plate ≤ 15 — иначе 400 Invalid payload.
 */

/** Клиентские лимиты длины (зеркало backend carFormSchema). */
export const VEHICLE_LIMITS = { model: 50, color: 30, plate: 15 } as const;

/**
 * Валидация формы. Номер опционален — обязательны только модель и цвет
 * (isFormValid в CarFormModal). Сообщения совпадают с VK-текстами.
 */
export function validateVehicleForm(
  model: string,
  color: string,
  plate: string,
): string | null {
  if (!model.trim()) {
    return "Укажите модель автомобиля";
  }
  if (model.trim().length > VEHICLE_LIMITS.model) {
    return "Модель не может быть длиннее 50 символов";
  }
  if (!color.trim()) {
    return "Укажите цвет автомобиля";
  }
  if (color.trim().length > VEHICLE_LIMITS.color) {
    return "Цвет не может быть длиннее 30 символов";
  }
  if (plate.trim().length > VEHICLE_LIMITS.plate) {
    return "Номер не может быть длиннее 15 символов";
  }
  return null;
}

/**
 * Нормализация перед POST|PATCH /users/me/car — зеркально CarFormModal:
 * трим, номер в верхнем регистре, пустой номер не отправляем
 * (JSON.stringify дропает undefined → backend хранит null, т.е. стирает
 * ранее сохранённый номер — remove-путь идентификатора).
 */
export function normalizeVehicleForm(
  model: string,
  color: string,
  plate: string,
): VehicleFormDto {
  const normalizedPlate = plate.trim().toUpperCase();
  return {
    model: model.trim(),
    color: color.trim(),
    ...(normalizedPlate ? { plate: normalizedPlate } : {}),
  };
}

/**
 * Дружелюбный текст серверной ошибки мутации (VK CarFormModal маппил
 * ApiError через getErrorMessage; в telegram-app маппинг локальный):
 * 401 — сессия, 429 — profileUpdateLimiter, 400 — валидация backend,
 * INVALID_RESPONSE — fail-closed валидация ответа клиентом.
 */
export function vehicleServerErrorMessage(error: unknown): string {  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Сессия истекла. Войдите заново и повторите.";
    }
    if (error.status === 429) {
      return "Слишком много попыток. Подождите и повторите позже.";
    }
    if (error.status === 400) {
      return "Проверьте данные формы и повторите.";
    }
    if (error.code === "INVALID_RESPONSE") {
      return "Сервер вернул некорректный ответ. Повторите позже.";
    }
    return error.message || "Не удалось сохранить автомобиль";
  }
  return error instanceof Error ? error.message : "Не удалось сохранить автомобиль";
}

/**
 * Дружелюбный текст ошибки удаления автомобиля (DELETE /users/me/car):
 * - 409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS — инвариант trips-creation
 *   (поездки требуют car): сначала завершите/отмените активные поездки;
 * - 404 — авто уже нет (гонка вкладок / повторный клик);
 * - остальное — общий маппинг vehicleServerErrorMessage.
 */
export function vehicleRemoveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 || error.code === "ACCOUNT_HAS_ACTIVE_OBLIGATIONS") {
      return "Нельзя удалить автомобиль: завершите или отмените активные поездки.";
    }
    if (error.status === 404) {
      return "Автомобиль уже удалён.";
    }
    return vehicleServerErrorMessage(error);
  }
  return error instanceof Error ? error.message : "Не удалось удалить автомобиль";
}
