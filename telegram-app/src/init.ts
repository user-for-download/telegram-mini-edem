import {
  setDebug,
  themeParams,
  initData,
  viewport,
  init as initSDK,
  mockTelegramEnv,
  type ThemeParamsType,
  type RGB,
  retrieveLaunchParams,
  emitEvent,
  miniApp,
  backButton,
  settingsButton,
  closingBehavior,
} from "@tma.js/sdk-react";

/**
 * Нормализация темы к snake_case для payload `theme_changed`.
 *
 * Сверено с .d.ts + рантаймом 3.0.23: `themeParams.state()` хранит ключи
 * как есть (геттеры читают `bg_color` и т.д.), `tgWebAppThemeParams`
 * из launch params — тоже snake_case, пример из docs шлёт их как есть.
 * То есть для текущих источников проход идемпотентен; конвертер страхует
 * от camelCase-источника (так отдавал `state()` в @telegram-apps 3.3.x):
 * без него emitEvent ушёл бы с неверными ключами и тема не применилась бы.
 */
export function toSnakeThemeParams(
  tp: Record<string, RGB | undefined>,
): ThemeParamsType {
  const out: Record<string, RGB | undefined> = {};
  for (const [key, value] of Object.entries(tp)) {
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
}

/**
 * Инициализация Telegram SDK (паттерн reactjs-template, скоуп @telegram-apps).
 *
 * Порядок важен:
 * 1. setDebug + initSDK() — чтение launch params из WebView.
 * 2. Mount компонентов, если доступны (ifAvailable/isAvailable — macOS и
 *    старые клиенты отвечают не на все методы; без проверок — hang/crash).
 * 3. themeParams.bindCssVars() — CSS-переменные темы для нативного вида.
 * 4. initData.restore() — восстановление сохранённой init data.
 */
export async function init(options: {
  debug: boolean;
  mockForMacOS: boolean;
}): Promise<void> {
  setDebug(options.debug);
  initSDK();

  // Telegram для macOS не отвечает на часть методов (известные баги клиента,
  // включая неверное safe_area-событие) — подменяем ответы локально.
  if (options.mockForMacOS) {
    let firstThemeSent = false;
    mockTelegramEnv({
      // .d.ts 3.0.23 (mockTelegramEnv.d.ts): onEvent получает ОБЪЕКТ
      // { name, params } + next (пример из docs: event.name).
      // Кортеж [method] был в @telegram-apps 3.3.x — с ним method всегда
      // undefined и ни одна ветка не срабатывает.
      onEvent(event, next) {
        if (event.name === "web_app_request_theme") {
          // Оба источника уже snake_case (см. toSnakeThemeParams):
          // state() хранит ключи как пришли в theme_changed,
          // tgWebAppThemeParams — как пришли в launch params.
          const raw = firstThemeSent
            ? themeParams.state()
            : retrieveLaunchParams().tgWebAppThemeParams;
          firstThemeSent = true;
          return emitEvent("theme_changed", {
            theme_params: toSnakeThemeParams(raw),
          });
        }

        if (event.name === "web_app_request_safe_area") {
          return emitEvent("safe_area_changed", {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
          });
        }

        // macOS не отвечает на фуллскрин-методы (известные пропуски клиента,
        // как с safe_area): подтверждаем текущее состояние без отказа —
        // иначе watchFullscreen засчитает fullscreen_failed.
        if (
          event.name === "web_app_request_fullscreen" ||
          event.name === "web_app_request_exit_fullscreen"
        ) {
          const webApp = (
            window as unknown as {
              Telegram?: { WebApp?: { isFullscreen?: boolean } };
            }
          ).Telegram?.WebApp;
          return emitEvent("fullscreen_changed", {
            is_fullscreen: Boolean(webApp?.isFullscreen),
          });
        }

        next();
      },
    });
  }

  // Mount всех используемых компонентов.
  // ВАЖНО (3.0.23, docs features/mini-app): mount() СИНХРОНЕН (mountSync
  // удалён, BetterPromise остался только у viewport.mount), каждый
  // вызывается РОВНО ОДИН РАЗ. themeParams — ПЕРВЫМ: miniApp при
  // монтировании читает значения темы (bgColorRgb и др. требуют
  // смонтированный themeParams). bindCssVars() — после mount своего
  // компонента.
  backButton.mount.ifAvailable();
  settingsButton.mount.ifAvailable();
  closingBehavior.mount.ifAvailable();
  initData.restore();

  if (themeParams.mount.isAvailable()) {
    themeParams.mount();
    themeParams.bindCssVars();
  }
  if (miniApp.mount.isAvailable()) {
    miniApp.mount();
  }

  if (viewport.mount.isAvailable()) {
    try {
      await viewport.mount();
      viewport.bindCssVars();
    } catch (error) {
      console.warn("[Telegram] Viewport initialization failed", error);
    }
  }

  // Раскрываем на всю высоту (официальная дока: без expand приложение
  // может открыться в пол-экрана через кнопку меню/инлайн).
  viewport.expand.ifAvailable();
}
