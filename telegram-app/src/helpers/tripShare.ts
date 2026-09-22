// telegram-app/src/helpers/tripShare.ts
// Шаринг поездки в Telegram:
// ссылка в формате, который принимает AppRouter.parseTripStartParam
// (`trip_<uuid>`), плюс hash-ссылка на детали для веба.
//
// Порядок (нативный UX первым):
// 1. внутри Telegram-клиента — shareURL SDK (нативный диалог t.me/share);
// 2. Web Share API (браузеры);
// 3. буфер обмена.


import { getRawInitData, shareViaTelegram } from "@/utils/telegram-adapter";

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

export async function shareTrip(
  tripId: string,
): Promise<"shared" | "copied" | "failed"> {
  const link = buildTripDeepLink(tripId);
  const text = `Присоединяйтесь к поездке: ${link}`;
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
    // Пользователь закрыл системный диалог — это не ошибка.
    if (
      shareError instanceof Error &&
      (shareError.name === "AbortError" || shareError.name === "NotAllowedError")
    ) {
      return "shared";
    }
    try {
      await navigator.clipboard.writeText(link);
      return "copied";
    } catch {
      return "failed";
    }
  }
}
