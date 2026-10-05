// Dev-стенд под pm2: backend (tsx watch, :3011) + frontend (vite HMR, :3012).
// БД — docker (telegram-mini-edem-db-dev :5433), ею pm2 не управляет.
module.exports = {
  apps: [
    {
      name: "edem-dev-backend",
      cwd: "./backend",
      script: "npm",
      args: "run dev",
      // ADMIN_TOKEN задан ЯВНО, и это не косметика. backend/src/env.ts зовёт
      // dotenv.config() без `override`, поэтому значение, уже лежащее в
      // process.env, побеждает backend/.env. Стенд поднимался из оболочки, где
      // был экспортирован корневой .env (там другой ADMIN_TOKEN), и pm2
      // наследовал его — dotenv тогда инжектил 9 ключей из 12, а e2e-шаги
      // review/support падали с 401 (проверено: тот же токен и на неизменённом
      // дереве).
      //
      // Значение — то же, что в backend/.env и в e2e/README.md, то есть
      // dev-публичный литерал, а не секрет. Смысл пина — сделать стенд
      // невосприимчивым к «залёгshell drift»: `pm2 restart --update-env` не
      // удаляет переменную, которой нет в оболочке.
      env: {
        FORCE_COLOR: "0",
        ADMIN_TOKEN: "dev-admin-token-12345",
      },
    },
    {
      name: "edem-dev-frontend",
      cwd: "./telegram-app",
      script: "npm",
      args: "run dev",
      env: { FORCE_COLOR: "0" },
    },
  ],
};
