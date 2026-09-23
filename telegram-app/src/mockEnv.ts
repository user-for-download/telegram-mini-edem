import { emitEvent, isTMA, mockTelegramEnv } from "@telegram-apps/sdk-react";
import { markTelegramMockEnv } from "@/utils/telegram-adapter";

// Мок Telegram-окружения для разработки в обычном браузере (вне Telegram).
// ВАЖНО: работает только при import.meta.env.DEV — в продакшн-сборке код
// внутри условия вырезается tree-shaking'ом, приложение вне Telegram
// покажет экран EnvUnsupported (main.tsx).
//
// hash='dev-hash' — НЕ валидная подпись, а ключ dev-bypass нашего бэкенда
// (см. backend/src/auth/telegramSign.ts): без TELEGRAM_BOT_TOKEN при
// ALLOW_DEV_AUTH сервер принимает такое initData и создаёт/находит юзера
// по user.id. Для тестирования реальной HMAC-цепочки подставьте в поле
// tgWebAppData настоящую строку initData из запуска в Telegram.
if (import.meta.env.DEV) {
  if (!(await isTMA("complete"))) {
    const themeParams = {
      accent_text_color: "#6ab2f2",
      bg_color: "#17212b",
      button_color: "#5288c1",
      button_text_color: "#ffffff",
      destructive_text_color: "#ec3942",
      header_bg_color: "#17212b",
      hint_color: "#708499",
      link_color: "#6ab3f3",
      secondary_bg_color: "#232e3c",
      section_bg_color: "#17212b",
      section_header_text_color: "#6ab3f3",
      subtitle_text_color: "#708499",
      text_color: "#f5f5f5",
    } as const;
    const noInsets = { left: 0, top: 0, bottom: 0, right: 0 } as const;

    mockTelegramEnv({      // onEvent в SDK 3.3.x принимает кортеж [method, payload].
      onEvent([method]) {
        // Обработчики методов платформы:
        // https://docs.telegram-mini-apps.com/platform/methods
        if (method === "web_app_request_theme") {
          return emitEvent("theme_changed", { theme_params: themeParams });
        }
        if (method === "web_app_request_viewport") {
          return emitEvent("viewport_changed", {
            height: window.innerHeight,
            width: window.innerWidth,
            is_expanded: true,
            is_state_stable: true,
          });
        }
        if (method === "web_app_request_content_safe_area") {
          return emitEvent("content_safe_area_changed", noInsets);
        }
        if (method === "web_app_request_safe_area") {
          return emitEvent("safe_area_changed", noInsets);
        }
        // Фуллскрин (Bot API 8.0): в dev-стенде клиент «подтверждает»
        // фуллскрин (в реальном Telegram приложение заходит уже в
        // фуллскрине), выход — соответственно сбрасывает.
        if (
          method === "web_app_request_fullscreen" ||
          method === "web_app_request_exit_fullscreen"
        ) {
          return emitEvent("fullscreen_changed", {
            is_fullscreen: method === "web_app_request_fullscreen",
          });
        }
      },
      launchParams: new URLSearchParams([
        ["tgWebAppThemeParams", JSON.stringify(themeParams)],
        [
          "tgWebAppData",
          new URLSearchParams([
            ["auth_date", ((new Date().getTime() / 1000) | 0).toString()],
            ["hash", "dev-hash"],
            // SDK 3.3.x требует поле signature в init data (валидация схемы
            // launch params; реальное значение — Ed25519-подпись Telegram
            // для third-party валидации). Бэкенд dev-bypass его игнорирует.
            ["signature", "dev-signature"],
            [
              "user",
              JSON.stringify({
                id: 9800001,
                first_name: "Dev",
                last_name: "Telegram",
                username: "dev_tg",
                language_code: "ru",
              }),
            ],
          ]).toString(),
        ],
        ["tgWebAppVersion", "8.4"],
        ["tgWebAppPlatform", "tdesktop"],
      ]),
    });

    // Мок не рисует нативные диалоги, но isAvailable() под ним true.
    // Браузер — среда разработки: UI-код (ConfirmPopup) смотрит этот
    // флаг и выполняет действие сразу, без подтверждения.
    markTelegramMockEnv();

    console.info(
      "⚠️ Окружение Telegram замокировано (только DEV). В проде приложение " +
        "вне Telegram показывает экран EnvUnsupported.",
    );
  }
}
