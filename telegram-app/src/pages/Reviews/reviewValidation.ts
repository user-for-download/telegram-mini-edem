import { REVIEW_TEXT_MAX_LENGTH } from "@edem/contracts";

/**
 * Поле формы отзыва — КЛЮЧ, а не DOM-id.
 *
 * Формы отзыва и жалобы живут на разных экранах и имеют разные id полей
 * (`review-trip`/`review-target`/`review-text`), поэтому возвращать здесь id
 * чужой формы было бы ложью: страница сама сопоставляет ключ со своим `Field id`
 * (паттерн supportValidation).
 */
export type ReviewField = "trip" | "target" | "text";

/**
 * Ошибка формы отзыва С ПРИВЯЗКОЙ К ПОЛЮ (паттерн reportValidation /
 * supportValidation).
 *
 * Раньше возвращалась одна строка, и textarea получала `aria-invalid` и
 * `status="error"` при ЛЮБОЙ ошибке формы: сообщение про выбор поездки
 * красило кольцо вокруг комментария, а у обоих `<Select>` не появлялось ни
 * aria-invalid, ни aria-describedby — при фокусе скринридер молчал
 * (MEMORY.md §18).
 */
export interface ReviewFieldError {
  field: ReviewField;
  message: string;
}

/**
 * Чистая валидация формы отзыва (порт CreateReviewModal).
 * Отдельный DOM-free модуль, чтобы покрыть unit-тестом без jsdom:
 * страница импортирует, тесты проверяют напрямую (паттерн profileValidation).
 *
 * Лимит текста — единая константа REVIEW_TEXT_MAX_LENGTH (150) из
 * @edem/contracts: тот же лимит enforced на записи через
 * createReviewDtoSchema (backend POST /reviews отклоняет текст > 150).
 *
 * Проверяется только комментарий: поездка выбирается из списка доступных, а
 * адресат берётся из броней/водителя, поэтому пустой выбор в форму не
 * попадает — `canSubmit` держит кнопку погашенной. Ошибки «выберите поездку»
 * и «не найден пользователь» возвращает сама страница, но с тем же ключом
 * поля, иначе сообщение снова окажется не привязано ни к одному контролу.
 */
export function validateReviewForm(text: string): ReviewFieldError | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { field: "text", message: "Добавьте комментарий к отзыву" };
  }
  if (trimmed.length > REVIEW_TEXT_MAX_LENGTH) {
    return {
      field: "text",
      message: `Максимум ${REVIEW_TEXT_MAX_LENGTH} символов`,
    };
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
