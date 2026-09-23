import {
  miniApp,
  openTelegramLink,
  popup,
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
 * данным не доверяем. Мок-окружения тут нет (только mockEnv.ts для dev),
 * но флаг «мок активен» живёт здесь: нативные UI-методы SDK
 * (popup.show и т.п.) под mockTelegramEnv рапортуют isAvailable()=true,
 * хотя показать диалог мок не может, — вызывающий код обязан
 * откатываться на инлайн-UI через isTelegramMockEnv().
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

const MOCK_FLAG = "__TG_ENV_MOCKED__";

/**
 * mockEnv.ts ставит флаг при включении mockTelegramEnv (только DEV).
 * Window-флаг, а не модульная переменная: адаптер импортируется
 * и в тестах, где мока нет, — ложных срабатываний быть не должно.
 */
export function markTelegramMockEnv(): void {
  try {
    (window as unknown as Record<string, boolean>)[MOCK_FLAG] = true;
  } catch {
    // ignore: SSR — флага нет, считаемся реальным окружением
  }
}

/**
 * true — SDK работает на mockTelegramEnv: isAvailable() нативных
 * UI-методов врёт (мок не рисует диалоги). Вызывающий код пропускает
 * нативные вызовы: в dev-браузере подтверждения не нужны, действие
 * выполняется сразу. SSR-safe: без window — false.
 */
export function isTelegramMockEnv(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return (
      (window as unknown as Record<string, unknown>)[MOCK_FLAG] === true
    );
  } catch {
    return false;
  }
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
 * Нативный confirm через popup клиента для мест, где триггер — не
 * текстовый Button (иконки −/+, IconButton): ConfirmPopup туда не встаёт.
 * Лимиты popup: title ≤64, message ≤256, текст кнопки ≤64.
 *
 * - мок (dev-браузер): true сразу — браузер dev-среда, без подтверждений;
 * - popup доступен: системный алерт, true только по кнопке confirm
 *   (закрытие без выбора — false);
 * - иначе false: клиент без popup (Bot API < 6.2) — вызывающий решает сам
 *   (как правило, ничего не делать: таких клиентов почти не осталось).
 * Исключений нет: ошибка SDK — тоже false.
 */
export async function nativeConfirm(options: {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
}): Promise<boolean> {
  try {
    if (isTelegramMockEnv()) return true;
    if (!popup.show.isAvailable()) return false;
    const buttonId = await popup.show({
      title: options.title,
      message: options.message,
      buttons: [
        { id: "cancel", type: "cancel" },
        {
          id: "confirm",
          type: options.destructive ? "destructive" : "default",
          text: options.confirmText,
        },
      ],
    });
    return buttonId === "confirm";
  } catch {
    return false;
  }
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
