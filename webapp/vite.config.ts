import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          if (!normalizedId.includes("/node_modules/")) return undefined;
          if (normalizedId.includes("/node_modules/react-dom/")) return "react-dom-vendor";
          if (normalizedId.includes("/node_modules/react/")) return "react-vendor";
          if (normalizedId.includes("/node_modules/@tanstack/react-router/") || normalizedId.includes("/node_modules/@tanstack/react-query/")) return "router-query";
          if (normalizedId.includes("/node_modules/lucide-react/") || normalizedId.includes("/node_modules/radix-ui/") || normalizedId.includes("/node_modules/sonner/")) return "ui-vendor";
          if (normalizedId.includes("/node_modules/zod/")) return "zod";
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Как и в mini-app: резолвим контракты из исходников, чтобы webapp
      // собирался без предварительной сборки dist в packages/contracts.
      "@edem/contracts": path.resolve(
        __dirname,
        "../packages/contracts/src/index.ts"
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    // Админка проксируется на admin.site.com; порт фиксирован (3013).
    port: 3013,
    // По умолчанию — loopback (audit: dev server exposure): дев-админка
    // с прокси на локальный backend не должна слушаться на всех
    // интерфейсах (DNS-rebinding / случайный доступ из LAN).
    // VITE_DEV_HOST=1 — явный opt-in для запуска за внешним прокси/туннелем.
    host: process.env.VITE_DEV_HOST === "1",
    // Host-заголовки ограничены: защита от DNS-rebinding. Vite допускает
    // localhost/IP всегда; внешний домен задают через VITE_DEV_ALLOWED_HOSTS
    // (например, VITE_DEV_ALLOWED_HOSTS=admin.site.com).
    allowedHosts: process.env.VITE_DEV_ALLOWED_HOSTS
      ? process.env.VITE_DEV_ALLOWED_HOSTS.split(",").map((host) => host.trim())
      : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3011",
        changeOrigin: true,
        // См. telegram-app/vite.config.ts: для WS http-proxy не добавляет
        // X-Forwarded-Host, а backend принимает same-origin за прокси
        // только по нему (loopback/TRUST_PROXY).
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.host) {
              proxyReq.setHeader("x-forwarded-host", req.headers.host);
            }
          });
          proxy.on("proxyReqWs", (proxyReq, req) => {
            if (req.headers.host) {
              proxyReq.setHeader("x-forwarded-host", req.headers.host);
            }
          });
        },
      },
    },
  },
});
