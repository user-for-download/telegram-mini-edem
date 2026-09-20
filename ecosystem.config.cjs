// Dev-стенд под pm2: backend (tsx watch, :3011) + frontend (vite HMR, :3012).
// БД — docker (telegram-mini-edem-db-dev :5433), ею pm2 не управляет.
module.exports = {
  apps: [
    {
      name: "edem-dev-backend",
      cwd: "./backend",
      script: "npm",
      args: "run dev",
      env: { FORCE_COLOR: "0" },
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
