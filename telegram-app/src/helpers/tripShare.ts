// telegram-app/src/helpers/tripShare.ts
// Шаринг поездки в Telegram:
// ссылка `t.me/<bot>?startapp=trip_<uuid>` открывает мини-апп сразу
// на поездке (токен строит buildTripStartParam — тот же формат, что
// принимает AppRouter.parseTripStartParam / resolveStartParamRoute).
// Имя бота — только из env (VITE_TELEGRAM_BOT_USERNAME), в коде
// юзернейм не зашит. Без env — фолбэк на веб-ссылку (dev не ломается).
//
// Порядок (нативный UX первым):
// 1. внутри Telegram-клиента — shareURL SDK (нативный диалог t.me/share);
// 2. Web Share API (браузеры);
// 3. буфер обмена.

import { getRawInitData, shareViaTelegram } from "@/utils/telegram-adapter";

export type TripShareResult = "shared" | "copied" | "cancelled" | "failed";

export function buildTripStartParam(tripId: string): string {
  return `trip_${tripId}`;
}

export function buildTripDeepLink(
  tripId: string,
  origin: string = globalThis.location?.origin ?? "http://localhost",
): string {
  const normalized = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${normalized}/#/trips/${encodeURIComponent(tripId)}`;
}

/**
 * Имя бота из окружения (VITE_TELEGRAM_BOT_USERNAME, `@` спереди
 * допускается). Пустое/отсутствующее — undefined, исключений нет.
 * env вынесен в параметр — чистая функция, тестируется без import.meta.
 */
export function getTelegramBotUsername(
  env: { VITE_TELEGRAM_BOT_USERNAME?: string } = import.meta.env,
): string | undefined {
  const clean = env.VITE_TELEGRAM_BOT_USERNAME?.trim()
    .replace(/^@/, "")
    .trim();
  return clean ? clean : undefined;
}

/**
 * Ссылка для шаринга: `https://t.me/<bot>?startapp=trip_<uuid>`.
 * botUsername по умолчанию — из env; явный аргумент — для тестов
 * и переопределений. Без имени бота — веб-ссылка buildTripDeepLink.
 */
export function buildTripShareLink(
  tripId: string,
  botUsername: string | undefined = getTelegramBotUsername(),
  origin: string = globalThis.location?.origin ?? "http://localhost",
): string {
  const clean = botUsername?.trim().replace(/^@/, "").trim();
  if (clean) {
    return `https://t.me/${clean}?startapp=${buildTripStartParam(tripId)}`;
  }
  return buildTripDeepLink(tripId, origin);
}

export type TripShareHaptic = "success" | "error" | null;

export interface TripShareFeedback {
  /** Текст статуса под кнопкой шаринга. */
  text: string;
  /** Нотификационная хаптика; null — нейтральный исход (отмена), без отдачи. */
  haptic: TripShareHaptic;
}

/**
 * Обратная связь по исходу шаринга: каждый исход различим.
 * shared/copied — успех, cancelled — нейтральный текст без хаптики
 * (пользователь сам закрыл диалог — «успехом» это не отмечаем),
 * failed — текст с подсказкой плюс error-хаптика.
 * Чистая функция — карта исходов тестируется без SDK/клиента.
 */
export function shareOutcomeFeedback(result: TripShareResult): TripShareFeedback {
  switch (result) {
    case "shared":
      return {
        text: "Ссылка отправлена — поделитесь поездкой с попутчиками",
        haptic: "success",
      };
    case "copied":
      return {
        text: "Ссылка скопирована — поделитесь поездкой с попутчиками",
        haptic: "success",
      };
    case "cancelled":
      return {
        text: "Отправка отменена — ссылка не отправлена",
        haptic: null,
      };
    case "failed":
      return {
        text: "Не удалось поделиться — скопируйте адрес страницы вручную",
        haptic: "error",
      };
  }
}

export async function shareTrip(
  tripId: string,
): Promise<TripShareResult> {
  const link = buildTripShareLink(tripId);
  // Текст БЕЗ дубля ссылки: ссылка уже идёт отдельным полем
  // (shareURL/Web Share/clipboard) — повтор в тексте давал её дважды.
  const text = "Присоединяйтесь к поездке в «Едем»!";
  // Внутри Telegram — нативный диалог шаринга (Web Share в WebView
  // обычно отсутствует, а редирект shareURL вне клиента нам не нужен:
  // наличие initData = признак TMA-сессии).
  if (getRawInitData() !== undefined && shareViaTelegram(link, text)) {
    return "shared";
  }
  try {
    const navigatorWithShare = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (typeof navigatorWithShare.share === "function") {
      await navigatorWithShare.share({ title: "Поездка", text, url: link });
      return "shared";
    }
    throw new Error("Web Share unavailable");
  } catch (shareError) {
    // Пользователь закрыл системный диалог — это отмена, а не отправка
    // и не ошибка: исход «cancelled» отличен от «shared».
    if (shareError instanceof Error && shareError.name === "AbortError") {
      return "cancelled";
    }
    // Остальное (NotAllowedError и др.) — не успех: пробуем буфер обмена,
    // а не возвращаем ложный «shared».
    try {
      await navigator.clipboard.writeText(link);
      return "copied";
    } catch {
      return "failed";
    }
  }
}
