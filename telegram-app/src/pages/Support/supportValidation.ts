import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
} from "@edem/contracts";
import { ApiError } from "@/api/client";

/**
 * Поле формы обращения — КЛЮЧ, а не DOM-id.
 *
 * Валидацию делят две формы с разными id (`support-subject`/`support-text`
 * в FeedbackForm и `appeal-subject`/`appeal-text` в AppealForm), поэтому
 * возвращать здесь id чужого экрана было бы ложью: каждый потребитель
 * сам сопоставляет ключ со своим `Field id`.
 */
export type SupportField = "subject" | "text";

/**
 * Ошибка формы обращения С ПРИВЯЗКОЙ К ПОЛЮ (паттерн reportValidation).
 *
 * Раньше возвращалась одна строка, и оба контрола получали статус «error»
 * независимо от того, о каком поле сообщение. Ошибка про тему красила
 * кольцо вокруг textarea, а у `<Input>` не появлялось ни aria-invalid,
 * ни aria-describedby — при фокусе скринридер молчал (MEMORY.md §18).
 */
export interface SupportFieldError {
  field: SupportField;
  message: string;
}

/**
 * Чистая валидация формы обращения в поддержку (порт FeedbackModal).
 * DOM-free модуль — покрывается unit-тестом без jsdom
 * (паттерн reviewValidation/profileValidation).
 *
 * Тексты сообщений — контракт app.md, не переписываются.
 *
 * Лимиты — единые константы FEEDBACK_*_MAX_LENGTH из @edem/contracts:
 * те же лимиты enforced на записи через createFeedbackDtoSchema
 * (backend POST /feedback отклоняет пустое/сверхлимитное тем же кодом 400).
 */
export function validateSupportForm(
  subject: string,
  text: string,
): SupportFieldError | null {
  const trimmedSubject = subject.trim();
  if (trimmedSubject.length === 0) {
    return { field: "subject", message: "Укажите тему обращения" };
  }
  if (trimmedSubject.length > FEEDBACK_SUBJECT_MAX_LENGTH) {
    return {
      field: "subject",
      message: `Тема: максимум ${FEEDBACK_SUBJECT_MAX_LENGTH} символов`,
    };
  }
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return { field: "text", message: "Опишите проблему или вопрос" };
  }
  if (trimmedText.length > FEEDBACK_TEXT_MAX_LENGTH) {
    return {
      field: "text",
      message: `Сообщение: максимум ${FEEDBACK_TEXT_MAX_LENGTH} символов`,
    };
  }
  return null;
}

/**
 * Нормализация перед POST /feedback: контракт тримит поля на записи
 * (createFeedbackDtoSchema: z.string().trim()…), отправляем уже обрезанное.
 */
export function normalizeSupportForm(subject: string, text: string): {
  subject: string;
  text: string;
} {
  return { subject: subject.trim(), text: text.trim() };
}

/**
 * Маппинг ошибок отправки обращения в текст для UI:
 * - 429 RATE_LIMITED — лимит с учётом retryAfterMs;
 * - 400 VALIDATION_FAILED — серверная санитизация/валидация отклонила payload;
 * - 401 — сессия умерла (ретрай refresh уже отработал в apiClient);
 * - 403 — бан mid-session (терминальный экран показывает AuthGate);
 * - остальное — сообщение сервера как есть.
 */
export function feedbackErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === "RATE_LIMITED") {
      const wait =
        typeof error.retryAfterMs === "number"
          ? ` Повторите через ${Math.ceil(error.retryAfterMs / 1000)} с.`
          : "";
      return `Слишком много обращений. Попробуйте позже.${wait}`;
    }
    if (error.status === 400 || error.code === "VALIDATION_FAILED") {
      return "Проверьте введённые данные: тема — до 100 символов, сообщение — до 2000.";
    }
    if (error.status === 401) {
      return "Нужна авторизация. Перезапустите приложение.";
    }
    if (error.status === 403) {
      return "Действие недоступно: аккаунт заблокирован.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Не удалось отправить обращение";
}
