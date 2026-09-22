import {
  REPORT_CATEGORIES,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_TARGET_TYPES,
  type Report,
} from "@edem/contracts";
import { ApiError } from "@/api/client";

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
  user: "Пользователь",
  trip: "Поездка",
  booking: "Бронь",
};

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  safety: "Безопасность",
  fraud: "Мошенничество",
  harassment: "Оскорбления",
  spam: "Спам",
  inaccurate_info: "Недостоверная информация",
  other: "Другое",
};

export const REPORT_STATUS_LABELS: Record<Report["status"], string> = {
  pending: "Ожидает рассмотрения",
  in_review: "На рассмотрении",
  resolved: "Рассмотрена",
  rejected: "Отклонена",
};

/**
 * Рантайм-гварды вместо cast: select возвращает произвольную строку из DOM
 * (паттерн ReportModal из mini-app). Неизвестное значение игнорируется.
 */
export function isReportCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isReportTargetType(value: string): value is ReportTargetType {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

/**
 * Чистая валидация формы жалобы (DOM-free, unit-тест без jsdom).
 * Лимит описания — REPORT_DESCRIPTION_MAX_LENGTH (2000) из @edem/contracts,
 * тот же лимит enforced backend через createReportDtoSchema.
 */
export function validateReportForm(
  targetId: string,
  description: string,
): string | null {
  if (targetId.trim().length === 0) {
    return "Укажите идентификатор объекта жалобы";
  }
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return "Опишите проблему";
  }
  if (trimmed.length > REPORT_DESCRIPTION_MAX_LENGTH) {
    return `Максимум ${REPORT_DESCRIPTION_MAX_LENGTH} символов`;
  }
  return null;
}

/**
 * Клиентский хинт лимита «1 жалоба навсегда»: сервер — источник правды
 * (409), здесь лишь гасим кнопку, чтобы не гонять форму впустую
 * (паттерн ReportModal из mini-app).
 */
export function hasExistingReport(
  reports: ReadonlyArray<Pick<Report, "targetType" | "targetId">>,
  targetType: string,
  targetId: string,
): boolean {
  const normalizedId = targetId.trim();
  if (!normalizedId) return false;
  return reports.some(
    (report) =>
      report.targetType === targetType && report.targetId === normalizedId,
  );
}

/**
 * Маппинг ошибок отправки жалобы (зеркалит ReportModal из mini-app):
 * 409 CONFLICT — жалоба на этот объект уже существует, 429 — лимит
 * с учётом retryAfterMs, 403 — нет связи с объектом (не участник поездки),
 * 400 — серверная санитизация/валидация, остальное — сообщение сервера.
 */
export function reportErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 || error.code === "CONFLICT") {
      return "Жалоба уже отправлена: повторная жалоба на этот объект недоступна.";
    }
    if (error.status === 429 || error.code === "RATE_LIMITED") {
      const wait =
        typeof error.retryAfterMs === "number"
          ? ` Повторите через ${Math.ceil(error.retryAfterMs / 1000)} с.`
          : "";
      return `Слишком много жалоб. Попробуйте позже.${wait}`;
    }
    if (error.status === 403 || error.code === "FORBIDDEN") {
      return "Жалоба недоступна: жалобы на поездку доступны пассажирам с бронью. На свою поездку жаловаться нельзя.";
    }
    if (error.status === 400 || error.code === "VALIDATION_FAILED") {
      return "Проверьте введённые данные: описание — до 2000 символов.";
    }
    if (error.status === 401) {
      return "Нужна авторизация. Перезапустите приложение.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Не удалось отправить жалобу";
}
