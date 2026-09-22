// ESLint 9 flat config: TS везде, react-hooks + jsx-a11y только во фронтах.
// Type-aware правила (recommendedTypeChecked) пока не включаем: медленно и
// шумно на tgui-типах — второй этап. Сначала: hooks-deps, a11y, база TS.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/generated/**",
      ".tmp/**",
      "dump/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-скрипты: plain JS, нужны node-глобалы.
    files: ["scripts/**/*.mjs", "*.config.*js"],
    languageOptions: {
      globals: {
        ...globals.node,
        // Node 22+: WebSocket — глобал рантайма, в globals-пакете его нет.
        WebSocket: "readonly",
      },
    },
  },
  {
    // e2e: Playwright-скрипты (node) + evaluate-колбэки (браузер).
    files: ["e2e/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // k6 load-test: свой рантайм, из глобалов нужен только __ENV.
    files: ["backend/load-test/**/*.js"],
    languageOptions: { globals: { __ENV: "readonly" } },
  },
  {
    // `_`-префикс = осознанно неиспользуемое (omit-деструктуризация,
    // заглушки колбэков). Остальное no-unused-vars ловит как раньше.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Фронтенды: хуки + a11y поверх базы.
    files: ["telegram-app/src/**/*.{ts,tsx}", "webapp/src/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
  },
);
