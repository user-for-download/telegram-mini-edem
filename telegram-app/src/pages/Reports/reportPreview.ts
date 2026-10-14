// telegram-app/src/pages/Reports/reportPreview.ts
// Чистые форматтеры строки жалобы (DOM-free — паттерн reportValidation.ts
// и searchFilters.ts: логика строки вынесена из компонента, чтобы её
// покрывал unit-тест без рендера).
//
// Разделение по назначению: В СПИСКЕ строка короткая (кит сам обрезает
// `subtitle` в одну строку), а ПОЛНЫЙ текст жалобы и ответ модерации живут в
// попапе. Поэтому превью здесь намеренно не режет текст «умно» — своей
// обрезкой мы бы завели вторую реализацию, которая со временем разъедется с
// китной.
import type { Report } from "@edem/contracts";

import { formatDuration, moscowNumericDate } from "@/utils/date";
import { plural } from "@/utils/plural";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
} from "./reportValidation";

/**
 * Тон статус-пилюли: ожидание — warning, работа — info, решение — success,
 * отказ — danger.
 */
export type ReportStatusTone = "warning" | "info" | "success" | "danger";

export function reportStatusTone(status: Report["status"]): ReportStatusTone {
  switch (status) {
    case "resolved":
      return "success";
    case "rejected":
      return "danger";
    case "in_review":
      return "info";
    default:
      return "warning";
  }
}

/**
 * Когда и как быстро закрыли жалобу: «10.09.2026 · через 3 ч».
 *
 * Возвращает МЕТУ ответа — дату и время ожидания, без подписи «Ответ
 * модерации»: подпись ставит попап (`ReportDetailsModal`), поэтому слово
 * «Ответ» живёт в одном месте. Иначе строка начиналась бы с «Ответ
 * модерации · Ответ 10.09.2026 · …» — двойным «ответом».
 *
 * Только для терминальных статусов: `resolvedAt` бэкенд ставит для
 * `resolved` и `rejected` и обнуляет при возврате в `in_review`
 * (backend/src/reports/index.ts), поэтому поле само служит признаком
 * закрытия — проверять статус здесь не нужно, достаточно `resolvedAt`.
 *
 * Разница берётся между двумя ISO-строками, а не между «сейчас и ответом»:
 * жалоба могла закрыться месяц назад, и «прошло 30 дней» ничего не
 * сообщает пользователю — его волнует, сколько он ЖДАЛ.
 *
 * Мусор на входе (`null`, неразобранная дата, отрицательная разница) даёт
 * пустую строку, а не «через -3 ч»: непонятная подпись хуже отсутствия.
 */
export function reportResponseMeta(report: Report): string {
  const resolvedAt = report.resolvedAt;
  if (resolvedAt === null) return "";
  const resolved = Date.parse(resolvedAt);
  const created = Date.parse(report.createdAt);
  if (!Number.isFinite(resolved) || !Number.isFinite(created)) return "";
  const minutes = Math.round((resolved - created) / 60_000);
  if (minutes < 0) return "";
  const waited = formatWaited(minutes);
  const date = moscowNumericDate(resolvedAt);
  if (date === "") return "";
  return waited ? `${date} · через ${waited}` : date;
}

/**
 * Интервал ожидания в словах: «45 мин», «3 ч», «1 ч 30 мин», «2 дня 1 ч».
 *
 * Отдельный форматтер, а не `formatDuration`: тот описывает длительность
 * поездки и «25 ч 30 мин» там осмысленно, а для ожидания ответа та же запись
 * читалась бы как ошибка. Сутки вынесены отдельной частью — жалобу действительно
 * ждут дни, и «через 25 ч» этому не соответствует.
 */
function formatWaited(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  if (days < 1) return formatDuration(minutes);
  const dayPart = `${days} ${plural(days, "день", "дня", "дней")}`;
  // Остаток отдаём тому же formatDuration («1 ч 30 мин»), а НЕ округляем до
  // целых часов: Math.round(90/60) дал бы «2 ч» вместо полутора и завышал бы
  // ожидание на полчаса.
  const rest = formatDuration(minutes - days * 1440);
  return rest ? `${dayPart} ${rest}` : dayPart;
}

/**
 * Строка 1: «Безопасность · Поездка» — категория и тип объекта жалобы.
 *
 * Всегда непусто (обе метки есть на любой жалобе), поэтому строка списка не
 * «схлопнется» никогда.
 */
export function reportPreviewTitle(report: Report): string {
  return `${REPORT_CATEGORY_LABELS[report.category]} · ${REPORT_TARGET_TYPE_LABELS[report.targetType]}`;
}

/**
 * Строка 2: начало описания жалобы.
 *
 * Обрезку делает сам кит (однострочный `subtitle`). Здесь только отсекаем
 * хвостовые пробелы и отдаём `undefined` для пустого описания — кит и у
 * уведомлений прячет пустые строки, и жалобы должны вести себя так же.
 * Неразобранное описание (пробелы) тоже считаем пустым, иначе строка
 * схлопнется в невидимую.
 */
export function reportPreviewSubtitle(report: Report): string | undefined {
  const description = report.description.trim();
  return description.length > 0 ? description : undefined;
}

/**
 * Имя строки для скринридера.
 *
 * Собирается из того, что строка показывает, ПЛЮС что она делает по тапу —
 * иначе на Cell с «плоским» содержимым скринридер читает только категорию и
 * статус, а действие («открыть подробности») не анонсируется.
 */
export function reportCellAriaLabel(report: Report): string {
  return [
    `Жалоба: ${REPORT_CATEGORY_LABELS[report.category]}`,
    REPORT_TARGET_TYPE_LABELS[report.targetType],
    REPORT_STATUS_LABELS[report.status],
    "открыть подробности",
  ].join(", ");
}
