import type { AdminReport } from "./api";

/**
 * Русские подписи enum-полей жалоб. Раньше бейджи и строка метаданных
 * показывали сырые идентификаторы (`pending`, `safety`, `user`) в русской
 * панели — та же проблема, что уже исправлена для статусов поездок и броней.
 *
 * Тип `Record<AdminReport[...], string>` делает полноту обязательной: новое
 * значение справочника не соберётся без подписи. Тест `labels.test.ts`
 * дополнительно пинит «подпись ≠ сырое значение».
 */
export const REPORT_STATUS_LABELS: Record<AdminReport["status"], string> = {
  pending: "Новая",
  in_review: "В работе",
  resolved: "Решена",
  rejected: "Отклонена",
};

export const REPORT_CATEGORY_LABELS: Record<AdminReport["category"], string> = {
  safety: "Безопасность",
  fraud: "Мошенничество",
  harassment: "Домогательства",
  inaccurate_info: "Недостоверная информация",
  spam: "Спам",
  other: "Другое",
};

export const REPORT_TARGET_TYPE_LABELS: Record<
  AdminReport["targetType"],
  string
> = {
  user: "Пользователь",
  trip: "Поездка",
  booking: "Бронь",
};
