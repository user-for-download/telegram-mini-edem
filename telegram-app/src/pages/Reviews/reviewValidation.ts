import { REVIEW_TEXT_MAX_LENGTH } from "@edem/contracts";

/**
 * Чистая валидация формы отзыва (порт CreateReviewModal из mini-app).
 * Отдельный DOM-free модуль, чтобы покрыть unit-тестом без jsdom:
 * страница импортирует, тесты проверяют напрямую (паттерн profileValidation).
 *
 * Лимит текста — единая константа REVIEW_TEXT_MAX_LENGTH (150) из
 * @edem/contracts: тот же лимит enforced на записи через
 * createReviewDtoSchema (backend POST /reviews отклоняет текст > 150).
 */
export function validateReviewForm(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "Добавьте комментарий к отзыву";
  }
  if (trimmed.length > REVIEW_TEXT_MAX_LENGTH) {
    return `Максимум ${REVIEW_TEXT_MAX_LENGTH} символов`;
  }
  return null;
}

/**
 * Нормализация перед POST /reviews: контракт тримит текст на записи
 * (createReviewDtoSchema: z.string().trim()…), отправляем уже обрезанное.
 */
export function normalizeReviewText(text: string): string {
  return text.trim();
}
