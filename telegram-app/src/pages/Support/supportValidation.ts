import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
} from "@edem/contracts";
import { ApiError } from "@/api/client";

/**
 * Чистая валидация формы обращения в поддержку (порт FeedbackModal из
 * mini-app). DOM-free модуль — покрывается unit-тестом без jsdom
 * (паттерн reviewValidation/profileValidation).
 *
 * Лимиты — единые константы FEEDBACK_*_MAX_LENGTH из @edem/contracts:
 * те же лимиты enforced на записи через createFeedbackDtoSchema
 * (backend POST /feedback отклоняет пустое/сверхлимитное тем же кодом 400).
 */
export function validateSupportForm(subject: string, text: string): string | null {
  const trimmedSubject = subject.trim();
  if (trimmedSubject.length === 0) {
    return "Укажите тему обращения";
  }
  if (trimmedSubject.length > FEEDBACK_SUBJECT_MAX_LENGTH) {
    return `Тема: максимум ${FEEDBACK_SUBJECT_MAX_LENGTH} символов`;
  }
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return "Опишите проблему или вопрос";
  }
  if (trimmedText.length > FEEDBACK_TEXT_MAX_LENGTH) {
    return `Сообщение: максимум ${FEEDBACK_TEXT_MAX_LENGTH} символов`;
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
