# Telegram staging deployment checklist

**Task:** tg-migration-20 (Telegram-only staging).
**Smoke:** `scripts/smoke-telegram-deployment.mjs`
**Compose:** `docker-compose.yml` (Telegram vars required).
**Env template:** `.env.example` (§Telegram Mini App staging).

## 1. Build

- [ ] `docker compose build backend` собирает Telegram-фронт
      `telegram-app/dist` (см. `backend/Dockerfile`).
- [ ] `VITE_API_URL` задан при сборке telegram-app, если API не same-origin.
- [ ] Образ содержит `prisma/` + `prisma.config.ts`: entrypoint выполняет
      `npx prisma migrate deploy` перед стартом (`backend/Dockerfile` CMD).

## 2. Environment (staging `.env`)

Required (compose fails fast без них):

- [ ] `POSTGRES_PASSWORD`, `JWT_SECRET` (≥32 символов), `CORS_ORIGINS`
- [ ] `TELEGRAM_BOT_TOKEN` — без него `/auth/telegram` отвечает 503
- [ ] `TELEGRAM_HOSTS` — без него все хосты отвечают 404;
      значение равно DNS-имени стейджа (напр. `tg-edem.example.com`)

Optional (дефолты покрывают):

- [ ] `TG_INIT_DATA_TTL_SECONDS` (дефолт 3600), `TELEGRAM_DELIVERY_ENABLED`
      (дефолт true), `TG_NOTIFICATION_DEDUPE_WINDOW_MS` (дефолт 60000)
- [ ] Rate-limit overrides при необходимости (дефолты = production)
- [ ] `ADMIN_TOKEN` пусто = админка закрыта (403 на всё)
- [ ] `ALLOW_DEV_AUTH` всегда `false` на стейдже (compose хардкодит)

## 3. Deploy & verify

- [ ] `sh scripts/prod-rebuild.sh` — build backend+webapp, recreate,
      опрос `GET /health/ready` → 200 (не `sleep`); красная проверка = exit 1
      с `docker compose ps` + логами. Опции: `--no-build` (смена `.env`),
      `--clean` (prune + `--no-cache`), `--smoke` (шаг ниже автоматически).
      `TG_HOST` берётся из `TELEGRAM_HOSTS`; `HEALTH_TIMEOUT` (дефолт 90с).
- [ ] Или вручную: `docker compose up -d db backend`
      (webapp-админка — по желанию)
- [ ] `docker compose ps`: `db` healthy, `backend` healthy
      (healthcheck: `GET /health/ready` → 200)
- [ ] Smoke:
      `BACKEND_URL=http://<staging>:3000 TG_HOST=<telegram-host> node scripts/smoke-telegram-deployment.mjs`
      (или `sh scripts/prod-rebuild.sh --no-build --smoke`)
      Ожидается 5/5: live, ready, TG-ассеты по Host, auth-shape,
      WS upgrade + 4401-timeout
- [ ] Ручная проверка: открыть Mini App в Telegram (dev — через mockEnv
      вне Telegram), вход, создание поездки, WebSocket-обновления

## 4. Operations

- [ ] Логи: stdout → json-file с ротацией 10m×3 (якорь `x-logging` в compose).
      Тела сообщений, токены, initData не логируются (аудит 18).
- [ ] Метрики: `METRICS_TOKEN` задан, `/metrics` доступен сборщику.
- [ ] Sentry: `SENTRY_DSN` задан (backend; фронт-Sentry удалён — клиентские ошибки идут через `POST /api/v1/client-errors` в Telegram-группу, см. `ERROR_ALERT_CHAT_ID`).
- [ ] Бэкап: `backend/scripts/backup.sh` по cron (verify + retention 14 дней).
- [ ] Откат: предыдущий образ + `pg_restore` снапшота (см. runbook §3).

## 5. Known non-goals (заблокировано отдельно)

- Bot API фоновая рассылка (ADR, Product-аппрув) — на стейдже не включать.
- Production-миграция аккаунтов (нет production-данных; см. runbook).
