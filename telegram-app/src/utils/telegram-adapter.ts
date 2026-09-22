import {
  miniApp,
  openTelegramLink,
  retrieveRawInitData,
  shareURL,
} from "@telegram-apps/sdk-react";

/**
 * Единая граница с Telegram SDK для UI-кода (язык utils/telegram.ts
 * примера, поверх @telegram-apps/sdk-react 3.3.x): весь прямой доступ
 * к SDK — только здесь, остальной код использует эти функции и остаётся
 * тестируемым без Telegram-клиента.
 *
 * Личность пользователя здесь НЕ извлекается: auth-payload строит стор
 * из сырой строки, а подпись проверяет бэкенд (HMAC) — клиентским
 * данным не доверяем. Мок-окружения тут нет (только mockEnv.ts для dev).
 */

/**
 * Сырая initData-строка ровно как её отдал Telegram — без пересортировки
 * и перекодировки, иначе HMAC на сервере не сойдётся.
 * Fail-closed: вне Telegram / при ошибке SDK — undefined, исключений нет.
 */
export function getRawInitData(): string | undefined {
  try {
    return retrieveRawInitData() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Пурж SDK-кэша launch params с сырой initData
 * (sessionStorage["tapps/launchParams"] — пишет bridge при инициализации,
 * сам не чистит; «материал сессии» иначе переживает logout в табе).
 * Ключ проверен по исходникам: toolkit `w()`/`T()` — sessionStorage +
 * префикс `tapps/`, bridge `R = "launchParams"`. Best-effort, SSR-safe:
 * ошибки игнорируем, сессия уже очищена вызывающим. Вызывается из
 * markAccountDeleted и clearSession стора.
 */
export function purgeLaunchParamsCache(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("tapps/launchParams");
    }
  } catch {
    // ignore: кэш — best-effort
  }
}

/** Сигнал WebView: контент готов к показу (убирает loading-скелетон Telegram). */
export function signalAppReady(): void {
  miniApp.ready.ifAvailable();
}

/**
 * Ссылка «поделиться в Telegram» (t.me/share/url). Чистая функция —
 * строится локально, клиента не касается.
 */
export function buildTelegramShareLink(appUrl: string, text: string): string {
  const params = new URLSearchParams({ url: appUrl, text });
  // URLSearchParams кодирует пробелы как `+` — Telegram ждёт `%20`
  // (тот же replace делает shareURL внутри SDK).
  return `https://t.me/share/url?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * Нативный шаринг через Telegram (shareURL SDK с fallback на
 * window.location внутри SDK при старом клиенте).
 * Возвращает false, если клиент не поддерживает метод или бросил
 * исключение — вызывающий откатывается на Web Share API / буфер обмена.
 * NB: ifAvailable — no-op (не исключение) на неподдерживаемом методе,
 * поэтому доступность проверяем явно через isAvailable().
 */
export function shareViaTelegram(appUrl: string, text: string): boolean {
  try {
    if (!shareURL.isAvailable()) return false;
    shareURL.ifAvailable(appUrl, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chat-URL участника по username (без `@`, пустое — null).
 * Чистая функция: личность не раскрывается, пока вызывающий не передал
 * username участника общей поездки.
 */
export function buildTelegramChatUrl(username: string | undefined): string | null {
  if (!username) return null;
  const clean = username.trim().replace(/^@/, "").trim();
  if (clean.length === 0) return null;
  return `https://t.me/${clean}`;
}

/**
 * Открыть t.me-ссылку нативно (чат участника, инвайт).
 * Не-t.me URL SDK отклоняет исключением — тоже false.
 * Возвращает false — вызывающий откатывается на window.open.
 * NB: см. shareViaTelegram — ifAvailable молчит на старых клиентах.
 */
export function openTelegramUrl(url: string): boolean {
  try {
    if (!openTelegramLink.isAvailable()) return false;
    openTelegramLink.ifAvailable(url);
    return true;
  } catch {
    return false;
  }
}
