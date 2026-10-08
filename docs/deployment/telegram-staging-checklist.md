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

### 3.1 Порядок: бэкенд ПЕРЕД клиентом

**Правило:** миграция и код бэкенда — до выкатки клиента. Обратный порядок
ломает все экраны с поездками.

Причина — в контрактах ответа. Новый бэкенд отдаёт поля, которых в старом
клиенте нет, и это безопасно: `tripSchema` **не** `.strict()`, поэтому лишние
ключи Zod отбрасывает молча, а не ругается. Обратное неверно: новый клиент
требует поля, которых в ответе старого бэкенда ещё нет, — и падает на
`client.ts` (`safeParse` → `INVALID_RESPONSE`, 502) на `/trips/my`,
`/bookings/my` и любом ответе с вложенной поездкой. Симптом узнаётся по
консоли клиента, а не по логам бэкенда, поэтому его легко списать на «сеть».

Требование появилось с опциями поездки (`autoComplete`, `matchingEnabled`,
2026-10-08). До них ответы бэкенда и требования клиента совпадали по определению.

- [ ] Сначала: миграция БД, затем бэкенд. Дождаться `GET /health/ready` → 200.
- [ ] Только после этого — клиент (сборка telegram-app).
- [ ] Откат делается в обратном порядке: сначала клиент, затем бэкенд.
      Бэкенд, откатанный раньше клиента, снова оставит клиент без полей.

### 3.2 Шаги

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

## 5. Стенд без docker (pm2 + vite dev) — миграция ручная

**Этот раздел не покрыт шагами §3, и именно на нём произошёл инцидент
2026-10-08.** Стенд поднимается pm2-процессами `edem-dev-backend`
(`tsx watch`) и `edem-dev-frontend` (`vite`, отдаёт живой исходник через
`/@vite/client`), без compose.

Чем он опаснее: **миграции здесь не применяются автоматически.** В
docker-пути их выполняет `CMD` образа (`npx prisma migrate deploy &&
node dist/src/index.js`, `backend/Dockerfile:78`), а в pm2-стенде такого
шага нет — `run_workflow.sh` делает только `prisma:validate`. Код при этом
обновляется мгновенно: `tsx watch` и `vite` подхватывают его без
перезапуска. Получается рассинхрон, который не выдаёт себя на старте:
приложение живое, запросы идут, а падает всё, что читает `Trip`.

- [ ] **Перед** обновлением кода на стенде: `npm run db:migrate:deploy
      --workspace=backend` (или `npm run db:push --workspace=backend`).
      Порядок: миграция → перезапуск/подхват кода → проверка.
- [ ] Проверить, что колонки на месте, ДО того как открывать Mini App:
      ```sql
      SELECT column_name FROM information_schema.columns
      WHERE table_name='Trip' AND column_name IN ('autoComplete','matchingEnabled');
      ```
      Пусто = миграция не применена, дальше открывать нечего.
- [ ] Учесть §3.1: на стенде фронт подхватывается автоматически, а
      бэкенд — нет. Рассинхрон «клиент новый, бэкенд старый» тут не
      требует деплоя фронта, он возникает сам собой.
- [ ] Отличать 500 `INTERNAL_ERROR` (бэкенд: нет колонки) от 502
      `INVALID_RESPONSE` (клиент: бэкенд не отдаёт новое поле). Первый
      ищется в логах бэкенда (`unhandled_error` + текст Prisma), второй
      виден только в консоли клиента — `[ApiClient] Zod validation failed`.

### 5.1 Дрейф `db push` против `_prisma_migrations`

`prisma db push` меняет схему **минуя** таблицу `_prisma_migrations`. На БД,
где миграции ведутся, это создаёт дрейф, и следующий `migrate deploy`
падает:

```
Error: P3018 … column "autoComplete" of relation "Trip" already exists (42701)
New migrations cannot be applied before the error is recovered from.
```

Восстановление — `migrate resolve`, а не повторный `deploy` и тем более не
`migrate reset` (он сносит данные):

```bash
# 1. Убедиться, что колонки УЖЕ на месте — resolve оправдан только тогда,
#    когда желаемое состояние достигнуто (проверить SQL из §5)
npx prisma migrate resolve --applied <имя_миграции>
# 2. Дальше deploy идёт штатно
npm run db:migrate:deploy --workspace=backend
```

`resolve --applied` честно помечает миграцию применённой, а упавшую
попытку — откатанной (в леджере появятся обе строки; это нормально и
`migrate status` после этого показывает «up to date»).

Главное — не применять `resolve` «на всякий случай»: он не выполняет SQL,
а только правит учёт. Если колонок нет, `resolve` пометит миграцию
применённой, и дрейф станет невидимым — расхождение всплывёт позже и
дальше. Правило: на БД с миграциями — `migrate deploy`; `db push` годится
только для чистых БД без учёта (и CI, где каждый прогон с нуля).

Инцидент 2026-10-08 вызван именно этим: колонки добавили `db push`-ом, а
запись в леджере не появилась.

## 6. Known non-goals (заблокировано отдельно)

- Bot API фоновая рассылка (ADR, Product-аппрув) — на стейдже не включать.
- Production-миграция аккаунтов (нет production-данных; см. runbook).
