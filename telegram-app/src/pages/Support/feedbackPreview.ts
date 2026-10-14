// telegram-app/src/pages/Support/feedbackPreview.ts
// Чистые форматтеры строки обращения (DOM-free — паттерн reportPreview.ts
// и supportValidation.ts: логика строки вынесена из компонента, чтобы её
// покрывал unit-тест без рендера).
//
// Разделение по назначению: В СПИСКЕ строка короткая (кит сам обрезает
// `subtitle` в одну строку), а ПОЛНЫЙ текст обращения и ответ поддержки
// живут в попапе. Своей «умной» обрезки здесь нет намеренно — она бы
// разъёзжалась с китной.
import type { UserFeedbackDto } from "@edem/contracts";

import { moscowNumericDate } from "@/utils/date";

/**
 * Тон статуса: ждём ответа — warning (как «Ожидает рассмотрения» у жалоб),
 * ответ пришёл — info.
 */
export type FeedbackStatusTone = "info" | "warning";

export interface FeedbackStatus {
  label: string;
  tone: FeedbackStatusTone;
}

/**
 * Статус обращения: `reply === null` — поддержка ещё не ответила.
 *
 * Обращение двухсостоянийное (ответ один, без промежуточных статусов), и оба
 * состояния подписаны словами: свёрнутая строка раньше показывала только тему,
 * из-за чего «есть ответ» приходилось выяснять раскрытием карточки.
 */
export function feedbackStatus(feedback: UserFeedbackDto): FeedbackStatus {
  return feedback.reply !== null
    ? { label: "Есть ответ", tone: "info" }
    : { label: "Ждём ответа", tone: "warning" };
}

/**
 * Строка 2: начало текста обращения.
 *
 * Обрезку делает сам кит (однострочный `subtitle`). Здесь только отсекаем
 * хвостовые пробелы и отдаём `undefined` для пустого текста — кит прячет
 * пустые строки, и обращения должны вести себя так же.
 */
export function feedbackPreviewSubtitle(
  feedback: UserFeedbackDto,
): string | undefined {
  const text = feedback.text.trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Имя строки для скринридера.
 *
 * Собирается из того, что строка показывает, ПЛЮС что она делает по тапу —
 * иначе на Cell с «плоским» содержимым скринридер читает только тему, а
 * действие («открыть подробности») не анонсируется.
 */
export function feedbackCellAriaLabel(feedback: UserFeedbackDto): string {
  return [
    `Обращение: ${feedback.subject}`,
    feedbackStatus(feedback).label,
    `отправлено ${moscowNumericDate(feedback.createdAt)}`,
    "открыть подробности",
  ].join(", ");
}
