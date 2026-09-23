import { useEffect } from "react";
import {
  requestContentSafeAreaInsets,
  requestSafeAreaInsets,
  useLaunchParams,
  useSignal,
  viewport,
} from "@telegram-apps/sdk-react";

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
 * (max(safeAreaInsetTop, contentSafeAreaInsetTop) — сигналы, т.е. только
 * данные клиента, без нашего же оверрайда) ниже порога хрома Telegram
 * (--tg-telegram-chromium-height из index.css, по умолчанию 56px),
 * выставляем на documentElement токен --tg-safe-area-top-min — третье
 * слагаемое max() в --tg-safe-area-top (index.css). Отдельный токен, а не
 * перезапись SDK-переменной: клиент шлёт viewport-события и в момент
 * фуллскрина, и переписал бы наш оверрайд обратно в 0.
 *
 * Параллельно пинаем клиента requestContentSafeAreaInsets()/
 * requestSafeAreaInsets() (ifAvailable: macOS/браузер молча пропустят):
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
const DEFAULT_THRESHOLD_PX = 96;

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

export function useTelegramChromiumFallback(): void {
  const isFullscreen = useSignal(viewport.isFullscreen);
  const safeTop = useSignal(viewport.safeAreaInsetTop);
  const contentTop = useSignal(viewport.contentSafeAreaInsetTop);
  const isIos = useIosClient();

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
    requestContentSafeAreaInsets.ifAvailable();
    requestSafeAreaInsets.ifAvailable();
    return cleanup;
  }, [isFullscreen, isIos, safeTop, contentTop]);
}
