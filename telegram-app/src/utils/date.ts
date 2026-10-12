// Общие чистые форматтеры дат/времени.

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
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
 * startOfDay сдвигает её на предыдущий день. Полные ISO-даты со временем
 * идут прежним путём.
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

/** «12 сентября» для ISO-даты; мусорный месяц/день — исходная строка. */
function formatDayMonth(dateIso: string): string {
  const [, month, day] = dateIso.split("-").map(Number);
  // Месяц обязан быть в 1..12: `new Date(2026, 12, 1)` молча перекатывается
  // на январь следующего года и остаётся валидным, а подстановка даёт
  // «1 undefined». Мусор с сервера (z.string без проверки формата) — исходной строкой.
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
    return dateIso;
  }
  return `${day} ${MONTHS_GENITIVE[month - 1] ?? ""}`.trim();
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
  return formatDayMonth(dateIso);
}

/**
 * «Сегодня/Завтра/Вчера/12 сентября» для КЛЮЧА московского дня
 * ("YYYY-MM-DD" из `moscowDayKey`): относительная подпись считается от
 * московского дня `now`, а не от зоны устройства. Без этого поездка с
 * отправлением «сегодня ночью по Москве» у клиента западнее МСК получала бы
 * «Завтра». Не-ключ (подпись бэка, мусор) уходит в обычный `dayLabel`.
 */
export function moscowDayLabel(
  dateIso: string,
  now: Date = new Date(),
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  if (!match) return dayLabel(dateIso, now);
  const target = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  const [year = 0, month = 1, day = 1] = moscowDayKey(now)
    .split("-")
    .map(Number);
  const diffDays = Math.round(
    (target - Date.UTC(year, month - 1, day)) / MS_IN_DAY,
  );
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Завтра";
  if (diffDays === -1) return "Вчера";
  return formatDayMonth(dateIso);
}

/**
 * «Сегодня/Завтра/Вчера/12 сентября» по ISO-моменту отправления.
 *
 * Точка входа для поездок. У них есть `departureAt` (ISO), тогда как
 * `trip.date` — ГОТОВАЯ ПОДПИСЬ бэка ru-RU («ср, 16 сентября»,
 * `serializers/index.ts` → formatDateRu). На такой строке `dayLabel`
 * не срабатывает: regex ждёт ISO-день, а `new Date("ср, 16 сентября")`
 * даёт Invalid Date, и функция отдаёт строку как есть — «Сегодня» и
 * «Завтра» на карточке поездки и в истории были недостижимы.
 *
 * Нечитаемый `departureAt` — прочерк: показывать вместо даты «Invalid Date»
 * или пустоту хуже.
 */
export function relativeMoscowDay(
  departureAt: string | undefined,
  now: Date = new Date(),
): string {
  if (!departureAt) return "—";
  const time = Date.parse(departureAt);
  if (!Number.isFinite(time)) return "—";
  const key = moscowDayKey(new Date(time));
  const label = moscowDayLabel(key, now);
  if (label === "Сегодня" || label === "Завтра" || label === "Вчера") {
    return label;
  }
  // ЧУЖОЙ год дописываем сами: `formatDayMonth` (и `moscowDayLabel`) год
  // отбрасывают, а «1 июня» для поездки 2030 года читается как прошедшая.
  const year = key.slice(0, 4);
  return year === moscowDayKey(now).slice(0, 4) ? label : `${label} ${year}`;
}

/** «Сегодня, 08:30». */
export function dayTimeLabel(
  dateIso: string,
  time: string,
  now?: Date,
): string {
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
export function formatArrivalTime(
  time: string,
  durationMinutes: number,
): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match || !Number.isFinite(durationMinutes) || durationMinutes <= 0)
    return "";
  const total =
    Number(match[1]) * 60 + Number(match[2]) + Math.round(durationMinutes);
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Ключ календарного дня в московской зоне: "YYYY-MM-DD".
 *
 * Нужен там, где сравниваются ДНИ, а не instants: «сегодня ли поездка»,
 * «этот же год». Сравнивать через date.toDateString() нельзя — это зона
 * устройства, и у клиента в UTC−5 «сегодня» начнётся на 5 часов раньше
 * московского. en-CA даёт ISO-подобный YYYY-MM-DD.
 *
 * Общий хелпер вместо копии `MOSCOW_TZ` в каждом модуле: правило
 * «время поездок показываем по Москве» должно быть одно.
 */
export function moscowDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: MOSCOW_TZ,
  }).format(date);
}

/** Московский час:минуты даты. */
export function moscowTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MOSCOW_TZ,
  }).format(date);
}

/** Смещение Москвы от UTC в миллисекундах на момент `instant`. */
function moscowOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MOSCOW_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN);
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return Number.isNaN(asUtc) ? 0 : asUtc - instant.getTime();
}

/**
 * «YYYY-MM-DDTHH:mm» из `<input type="datetime-local">` → момент времени.
 *
 * Обратная сторона `toLocalDateTimeInputValue` и главная причина, по которой
 * дефолт и разбор не должны совпадать: поле отдаёт СТРОКУ без зоны, и
 * `new Date(value)` читает её в зоне УСТРОЙСТВА. Всё остальное приложение
 * показывает по Москве, поэтому ввод «20.10 08:00» должен означать 08:00
 * ПО МОСКВЕ — иначе водитель из Дубая публикует поездку на час раньше той,
 * которую сам же увидит в ленте.
 *
 * Смещение берётся из самой зоны (а не константой «−180»), чтобы правило не
 * разъехалось с зоной при её переводе. Пересчёт делается дважды: первое
 * приближение может попасть на границу смены смещения, где смещение другое.
 *
 * Мусорный ввод — `null`, а не Invalid Date: вызывающий код уже умеет
 * показывать «укажите дату и время» (см. `buildTripDraft`).
 */
export function fromMoscowDateTimeInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  // Без дефолтов `noUncheckedIndexedAccess` даёт `number | undefined`, а
  // Date.UTC требует number. `slice(1)` — ровно пять компонентов, без
  // ведущей запятой: она сдвинула бы год на месяц.
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0] = match
    .slice(1)
    .map(Number);
  // Час/минута/месяц обязаны быть в своих границах: Date.UTC перекатывает
  // `month: 13` на январь следующего года и возвращает валидную дату вместо
  // мусора, и поездка уехала бы на год из одной опечатки в форме.
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(wallClockUtc)) return null;
  const firstPass = new Date(
    wallClockUtc - moscowOffsetMs(new Date(wallClockUtc)),
  );
  const secondPass = new Date(wallClockUtc - moscowOffsetMs(firstPass));
  return Number.isNaN(secondPass.getTime()) ? null : secondPass;
}

/**
 * Московская дата в формате «01.10.2026» — для обращений и жалоб.
 * Общий хелпер: время показываем по Москве (timeZone обязателен —
 * без него дата зависит от зоны устройства).
 *
 * Невалидный ввод — исходная строка, чтобы UI не показывал «Invalid Date».
 */
export function moscowNumericDate(value: string | undefined): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: MOSCOW_TZ,
  }).format(new Date(time));
}

/** Московская дата даты: "2 июн." или "2 июн. 2029" (другой год — с годом). */
export function moscowDateLabel(date: Date, withYear: boolean): string {
  return new Intl.DateTimeFormat(
    "ru-RU",
    withYear
      ? { day: "numeric", month: "short", year: "numeric", timeZone: MOSCOW_TZ }
      : { day: "numeric", month: "short", timeZone: MOSCOW_TZ },
  ).format(date);
}

/**
 * Контекст московского дня относительно now: сегодня ли и тот же ли год.
 * Один расчёт для времени поездки и времени уведомления.
 */
export function moscowDayContext(
  date: Date,
  now: Date = new Date(),
): { isToday: boolean; sameYear: boolean } {
  const dayKey = moscowDayKey(date);
  const todayKey = moscowDayKey(now);
  return {
    isToday: dayKey === todayKey,
    sameYear: dayKey.slice(0, 4) === todayKey.slice(0, 4),
  };
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
