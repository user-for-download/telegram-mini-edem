import { ApiError } from "@/lib/api-client";

/**
 * Состояние формы города. Вынесено из компонента, чтобы решение об ошибке
 * мутации было чистой функцией: webapp-тесты работают в node-окружении без
 * DOM, а CitiesPage нельзя импортировать без React-дерева.
 */
export interface CityFormState {
  name: string;
  /** Серверные ошибки полей (из 400 VALIDATION_FAILED с `errors`). */
  fieldError?: string;
}

export const EMPTY_CITY_FORM: CityFormState = { name: "" };

/**
 * Решение по форме при ошибке мутации.
 *
 * Восстановимые коды сохраняют набранное имя: 409 «город с таким именем уже
 * есть» — самый частый исход и перепечатывать название целиком незачем,
 * 400 (валидация) — сообщение сервера и так объясняет, что поправить.
 * Остальное (неизвестная ошибка, 5xx, не-ApiError) очищает форму: там нет
 * смысла держать ввод, который уже не привязан к валидному состоянию.
 */
export function cityFormOnMutationError(
  error: unknown,
  current: CityFormState,
): CityFormState {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return { name: current.name, fieldError: "Город с таким именем уже существует" };
    }
    if (error.status === 400) {
      return { name: current.name, fieldError: error.message };
    }
  }
  return EMPTY_CITY_FORM;
}
