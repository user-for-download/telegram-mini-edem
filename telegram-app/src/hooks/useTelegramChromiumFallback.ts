import { useEffect } from "react";
import {
  request,
  useLaunchParams,
  useSignal,
  viewport,
} from "@tma.js/sdk-react";

/**
 * Компенсация нулевой/заниженной верхней врезки во фуллскрине на iOS.
 *
 * Симптом (реальное устройство: iPhone 11, Telegram 12.9.4, фуллскрин):
 * клиент рисует плавающий хром — пилюлю «Закрыть», ⌄ и ••• — поверх вебвью,
 * но итоговая --tg-safe-area-top вычисляется в 0: contentSafeAreaChanged
 * приходит нулевым/заниженным (тикеты tma.js #695/#704), а системный
 * env(safe-area-inset-top) внутри Mini App-вебвью Telegram всегда 0
 * (TelegramMessenger/Telegram-iOS#1377) — max(env, SDK) из index.css не спасает.
 * Вдобавок после fullscreen_changed врезка может применяться с задержкой
 * до секунд (#704): даже честный клиент временами отдаёт 0.
 *
  * Решение: пока активен фуллскрин на iOS-клиенте и клиентская врезка
  * (max(safeAreaInsets.top, contentSafeAreaInsets.top) — сигналы, т.е.
  * только данные клиента, без нашего же оверрайда) ниже порога хрома Telegram
 * (--tg-telegram-chromium-height из index.css, по умолчанию 88px),
 * выставляем на documentElement токен --tg-safe-area-top-min — третье
 * слагаемое max() в --tg-safe-area-top (index.css). Отдельный токен, а не
 * перезапись SDK-переменной: клиент шлёт viewport-события и в момент
 * фуллскрина, и переписал бы наш оверрайд обратно в 0.
 *
  * Параллельно пинаем клиента request('web_app_request_safe_area',
  * 'safe_area_changed') / request('web_app_request_content_safe_area', ...):
  * если врезка просто задержалась (#704), ответ обновит сигналы, условие
 * «ниже порога» развалится и компенсация снимется сама, без мигания
 * (пол downwards: floor → честное значение ≥ порога).
 *
 * Не фуллскрин и не-iOS не трогаем: в обычном режиме вебвью целиком ниже
 * нативной шапки, врезки приходят корректными (проверено на этом же
 * устройстве), а Android/десктоп отдают врезки сразу после запроса.
 */

/** Токен-floor на :root — третье слагаемое max() в --tg-safe-area-top. */
const OVERRIDE_TOKEN = "--tg-safe-area-top-min";
/** Порог хрома Telegram (index.css): читается на каждом применении. */
const THRESHOLD_VAR = "--tg-telegram-chromium-height";
/** Fallback порога, если CSS ещё не догрузился (jsdom, SSR).
 * Синхронизирован с --tg-telegram-chromium-height в index.css. */
const DEFAULT_THRESHOLD_PX = 88;

/** Числовой порог из CSS-переменной (значение — simple length). */
function readThresholdPx(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(THRESHOLD_VAR)
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_PX;
}

/** iOS-клиент Telegram? Launch params недоступны вне Telegram — не iOS
 * (custom-hook-обёртка: rules-of-hooks разрешает try/catch только в хуках,
 * паттерн useTguiPlatform). */
function useIosClient(): boolean {
  try {
    return useLaunchParams().tgWebAppPlatform === "ios";
  } catch {
    return false;
  }
}

/**
 * Пинок клиента перечитать врезки.
 *
 * Статические requestSafeAreaInsets/requestContentSafeAreaInsets удалены
 * в 3.0.x (migration guide: «use the SDK's request function») — шлём
 * запросы напрямую: ответы safe_area_changed/content_safe_area_changed
 * обновят сигналы viewport, повторный прогон эффекта снимет floor сам.
 * Ошибки гасим — эквивалент старого .ifAvailable(): macOS/браузер,
 * не отвечающие на safe-area, молча пропускаются, floor остаётся
 * до размонтирования (семантика «--tg-safe-area-top не в 0» сохранена:
 * хук только ставит floor-токен или снимает его, чужие значения не трогает).
 */
function nudgeClient(): void {
  try {
    request("web_app_request_safe_area", "safe_area_changed").catch(() => {});
    request(
      "web_app_request_content_safe_area",
      "content_safe_area_changed",
    ).catch(() => {});
  } catch {
    // ignore: клиент без safe-area — floor остаётся до размонтирования
  }
}

export function useTelegramChromiumFallback(): void {
  const isFullscreen = useSignal(viewport.isFullscreen);
  // Объектные сигналы 3.0.x (docs features/viewport): числовые
  // safeAreaInsetTop/contentSafeAreaInsetTop — производные от них
  // (safeAreaInsets()["top"]), семантика замера та же.
  const safeArea = useSignal(viewport.safeAreaInsets);
  const contentSafeArea = useSignal(viewport.contentSafeAreaInsets);
  const isIos = useIosClient();
  const safeTop = safeArea?.top ?? 0;
  const contentTop = contentSafeArea?.top ?? 0;

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const cleanup = (): void => {
      rootStyle.removeProperty(OVERRIDE_TOKEN);
    };

    if (!isFullscreen || !isIos) {
      cleanup();
      return cleanup;
    }

    const threshold = readThresholdPx();
    // Только данные клиента (сигналы): наш оверрайд в замере не участвует.
    if (Math.max(safeTop, contentTop) >= threshold) {
      cleanup();
      return cleanup;
    }

    // Символьное значение: порог меняется в CSS — floor следует за ним.
    rootStyle.setProperty(OVERRIDE_TOKEN, `var(${THRESHOLD_VAR})`);
    // Пинок клиента: врезка могла задержаться после fullscreen_changed
    // (#704). Ответы обновят сигналы → повторный прогон снимет floor.
    nudgeClient();
    return cleanup;
  }, [isFullscreen, isIos, safeTop, contentTop]);
}
