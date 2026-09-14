// Общие чистые форматтеры дат/времени (язык примера edem-telegram-mini-app,
// но «сегодня» вычисляется от реальной даты, а не константы демо-данных).

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

const MS_IN_DAY = 24 * 60 * 60 * 1000;

/** Локальная дата (не UTC) в ISO-формате YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** «Сегодня» / «Завтра» / «Вчера» / «12 сентября» относительно now. */
export function dayLabel(dateIso: string, now: Date = new Date()): string {
  const target = startOfDay(new Date(dateIso));
  if (Number.isNaN(target.getTime())) return dateIso;
  const diffDays = Math.round(
    (target.getTime() - startOfDay(now).getTime()) / MS_IN_DAY,
  );
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Завтра";
  if (diffDays === -1) return "Вчера";
  const [, month, day] = dateIso.split("-").map(Number);
  if (!month || !day) return dateIso;
  return `${day} ${MONTHS_GENITIVE[month - 1]}`;
}

/** «Сегодня, 08:30». */
export function dayTimeLabel(dateIso: string, time: string, now?: Date): string {
  return `${dayLabel(dateIso, now)}, ${time}`;
}

/** Минуты → «1 ч 30 мин» / «45 мин». */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

/** Время прибытия «ЧЧ:ММ» = отправление + длительность (через полночь — по модулю суток). */
export function formatArrivalTime(time: string, durationMinutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return "";
  const total = Number(match[1]) * 60 + Number(match[2]) + Math.round(durationMinutes);
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
