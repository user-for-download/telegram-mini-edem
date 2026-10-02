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
{
    // Фасад ui/: кит не импортируется напрямую там, где есть наша обёртка.
    // Button/IconButton/Card/List/Cell/Section — у них фасад владеет и видом,
    // и a11y-инвариантами (тап-таргет, accessibility name, уровень заголовка).
    // Примитивы без обёртки (Text, Avatar, Skeleton, Placeholder…) импортируются
    // из кита напрямую — это осознанно (см. telegram-app/src/ui/README.md,
    // раздел «Что фасад НЕ закрывает»).
    files: ["telegram-app/src/**/*.{ts,tsx}"],
    ignores: ["telegram-app/src/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@telegram-apps/telegram-ui",
              // Cell добавлен 2026-10-01 вместе с фасадом ui/Cell: интерактивная
              // строка должна быть нативной кнопкой, а вид (сброс UA-стилей,
              // единый box-sizing) решает фасад — иначе 12 мест правят UA-течь
              // вручную. Обходной путь `div` + role без нативного корня на
              // NotificationsPage — не запрещаем: он осознанный и доступный.
              // Section добавлен 2026-10-02 вместе с фасадом ui/Section: кит
              // зашивает Component:"h1" в SectionHeader, поэтому страница из
              // нескольких секций получала по h1 на заголовок (замер: 4/6/3 на
              // Поддержке/Профиле/форме поездки). Обойти можно было узлом — но
              // терялась обёртка <header> с её паддингом, то есть семантику
              // чинили в ущерб вёрстке. Фасад повторяет и то, и другое.
              importNames: [
                "Button",
                "IconButton",
                "Card",
                "List",
                "Cell",
                "Section",
              ],
              message:
                "Импортируйте обёртку из @/ui: Button, IconButton, Card, Cell, Section, Page (вместо List). Фасад держит единый вид, тап-таргет, нативную семантику строки, уровень заголовка секции и доступные имена.",
            },
          ],
        },
      ],
    },
  },
  {
    // Контракт кита — часть аппарата фасада: он рендерит Button/IconButton/
    // List кита НАПРЯМУЮ, чтобы сверить наш variant с настоящим mode кита
    // (иначе сверять не с чем, и подмена «bezeled → gray» проходит молча).
    // Правило выше остаётся в силе для всего остального приложения.
    files: ["telegram-app/src/__tests__/kitContract.test.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Однонаправленность слоёв: ui/ — низ, он не знает про экраны.
    files: ["telegram-app/src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/pages/*",
                "@/components/*",
                "@/queries/*",
                "@/store/*",
                "@/providers/*",
              ],
              message:
                "Слой ui/ — самый низ: он не импортирует экраны, компоненты, запросы, сторы и провайдеры (только кит, @/ui/*, @/hooks/*, @/utils/*).",
            },
          ],
        },
      ],
    },
  },
);
