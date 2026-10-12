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
