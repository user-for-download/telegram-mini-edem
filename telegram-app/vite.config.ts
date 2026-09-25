import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8")
) as {
  version?: string;
};

export default defineConfig(({ mode }) => {
  // Как в mini-app: фиксируем NODE_ENV для продакшн-сборок, чтобы React
  // собрался в production-варианте независимо от амбиентного окружения.
  if (mode === "production" && process.env.NODE_ENV !== "production") {
    process.env.NODE_ENV = "production";
  }
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const apiTarget = env.VITE_API_TARGET ?? "http://127.0.0.1:3011";

  return {
    // Относительные пути ассетов: приложение открывается из Telegram WebView
    // и через reverse proxy — абсолютные /assets/... сломаются.
    base: './',
    plugins: [
      react(),
      // PWA отключён и здесь: Service Worker кэширует старую версию и
      // конфликтует с деплоем.
      // Для Telegram WebView офлайн не критичен, белый экран — критичен.
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
        "@edem/contracts": path.resolve(
          import.meta.dirname,
          "../packages/contracts/src/index.ts"
        ),
        "react": path.resolve(import.meta.dirname, "../node_modules/react"),
        "react-dom": path.resolve(import.meta.dirname, "../node_modules/react-dom"),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? "0.1.0"),
    },
    build: {
      chunkSizeWarningLimit: 400,
      // Vite 8: Rolldown, manualChunks deprecated — codeSplitting.groups.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                // Telegram UI + транзитивные зависимости — самодостаточный чанк
                name: "tgui-vendor",
                test: /node_modules\/(@telegram-apps\/(telegram-ui|sdk-react|sdk|bridge|signals|types|transformers|toolkit)|@twa-dev|@floating-ui|@xelene|@swc\/helpers|clsx)\//,
                priority: 20,
              },
              {
                name: "react-vendor",
                test: /node_modules\/(react|react-dom|scheduler)\//,
                priority: 20,
              },
              {
                name: "vendor",
                test: /node_modules\//,
              },
            ],
          },
        },
      },
    },
    server: {
      // Доступ через туннель/домен — иначе Vite блокирует запросы
      // с незнакомых Host-заголовков. Дефолтный dev-домен зашит,
      // дополнительные хосты — через VITE_ALLOWED_HOSTS (запятая).
      allowedHosts: [
        ...new Set([
          "tg-dev.biet.site",
          "edem-dev.biet.site",
          ...(env.VITE_ALLOWED_HOSTS
            ? env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim())
            : []),
        ].filter(Boolean)),
      ],
      proxy: {
        "/api": {
          target: apiTarget,
          ws: true,
          changeOrigin: true,
        },
      },
      hmr: env.DISABLE_HMR !== "true",
      watch: env.DISABLE_HMR === "true" ? null : {},
    },
  };
});
