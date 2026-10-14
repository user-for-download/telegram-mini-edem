// telegram-app/src/pages/Reports/reportTarget.ts
// Чистые форматтеры объекта жалобы для выпадающего списка (DOM-free —
// паттерн reportPreview.ts: строки вынесены из компонента, чтобы их
// покрывал unit-тест без рендера).
import type { ReportTarget } from "@edem/contracts";

import { moscowNumericDate } from "@/utils/date";
import { REPORT_TARGET_TYPE_LABELS } from "./reportValidation";

/**
 * Значение опции <select>: тип и id вместе («trip:…», «user:…»).
 *
 * Одна строка на выбор — потому что тип и id неразделимы: id поездки со
 * `targetType: "user"` сервер отвергнет (canReport), а пользователю тогда
 * покажут объяснение про объект другого типа (регресс L6). Собирая значение
 * из одного объекта, форму невозможно привести к такому рассинхрону.
 */
export function reportTargetKey(
  target: Pick<ReportTarget, "targetType" | "id">,
): string {
  return `${target.targetType}:${target.id}`;
}

/**
 * Подпись объекта в списке. Нативный <select> не умеет двух строк, поэтому
 * всё в одну: тип, маршрут (или имя) и дату поездки.
 *
 * Дата — по Москве (`moscowNumericDate`), как везде в приложении; поле
 * `departureAt` у поездки непустое (DateTime в схеме), поэтому «—» здесь не
 * появится.
 */
export function reportTargetLabel(target: ReportTarget): string {
  const type = REPORT_TARGET_TYPE_LABELS[target.targetType];
  if (target.targetType === "user") {
    return `${type}: ${target.name}`;
  }
  return `${type}: ${target.fromCity} → ${target.toCity}, ${moscowNumericDate(target.departureAt)}`;
}
