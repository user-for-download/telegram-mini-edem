// Общие чистые форматтеры дат/времени (язык примера edem-telegram-mini-app,
// но «сегодня» вычисляется от реальной даты, а не константы демо-данных).

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const MOSCOW_TZ = "Europe/Moscow";

/** Локальная дата (не UTC) в ISO-формате YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Локальное время для <input type="datetime-local"> ("YYYY-MM-DDTHH:mm").
 * toISOString() здесь нельзя: он даёт UTC, а поле ждёт локальное —
 * в Москве дефолт уезжал на 3 часа назад.
 */
export function toLocalDateTimeInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${toIsoDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Date-only "YYYY-MM-DD" как локальный календарный день. `new Date("…")`
 * парсит такую строку в UTC-полночь, и в часовых поясах западнее UTC
 * startOfDay сдвигал её на предыдущий день — метки «Сегодня/Завтра»
 * врали. Полные ISO-даты со временем идут прежним путём.
 */
function parseDay(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const local = new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
    return Number.isNaN(local.getTime()) ? null : local;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** «Сегодня» / «Завтра» / «Вчера» / «12 сентября» относительно now. */
export function dayLabel(dateIso: string, now: Date = new Date()): string {
  const parsed = parseDay(dateIso);
  if (!parsed) return dateIso;
  const target = startOfDay(parsed);
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

/**
 * ISO-момент → «30 сентября, 18:30» в московском времени. Невалидный
 * ввод — «—». Для сущностей без своих date/time-полей (запросы попуток):
 * сырой ISO в UI не показываем.
 */
export function formatMoscowDateTime(value: string | undefined): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  const date = new Date(time);
  const day = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: MOSCOW_TZ,
  }).format(date);
  const clock = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MOSCOW_TZ,
  }).format(date);
  return `${day}, ${clock}`;
}
