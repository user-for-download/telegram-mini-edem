import {
  setDebug,
  themeParams,
  initData,
  viewport,
  init as initSDK,
  mockTelegramEnv,
  type ThemeParams,
  retrieveLaunchParams,
  emitEvent,
  miniApp,
  backButton,
  settingsButton,
  expandViewport,
  mountClosingBehavior,
} from "@telegram-apps/sdk-react";

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
      // onEvent в SDK 3.3.x принимает кортеж [method, payload]
      // (в @tma.js 3.0.x из шаблона был объект { name }).
      onEvent([method], next) {
        if (method === "web_app_request_theme") {
          let tp: ThemeParams;
          if (firstThemeSent) {
            tp = themeParams.state();
          } else {
            firstThemeSent = true;
            tp = retrieveLaunchParams().tgWebAppThemeParams;
          }
          return emitEvent("theme_changed", { theme_params: tp });
        }

        if (method === "web_app_request_safe_area") {
          return emitEvent("safe_area_changed", {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
          });
        }

        next();
      },
    });
  }

  // Mount всех используемых компонентов.
  // ВАЖНО (SDK 3.3.x): каждый mount() вызывается РОВНО ОДИН РАЗ —
  // повторный вызов во время in-flight монтажа бросает
  // "component is already mounting". miniApp.mount() внутри себя
  // монтирует themeParams, поэтому явный themeParams.mount() НЕ вызываем
  // (в @tma.js 3.0.x из шаблона этой зависимости не было).
  backButton.mount.ifAvailable();
  settingsButton.mount.ifAvailable();
  mountClosingBehavior.ifAvailable();
  initData.restore();

  if (miniApp.mount.isAvailable()) {
    // mount() асинхронен: резолвится ПОСЛЕ внутреннего монтажа themeParams.
    // bindCssVars() требует смонтированный компонент — ждём (в 3.0.x из
    // шаблона mount был синхронным, await не требовался).
    await miniApp.mount();
    themeParams.bindCssVars();
  } else if (themeParams.mount.isAvailable()) {
    // miniApp недоступен, но тема доступна — монтируем напрямую.
    await themeParams.mount();
    themeParams.bindCssVars();
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
  expandViewport.ifAvailable();
}
