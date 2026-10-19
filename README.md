# Edem — Сервис попутных поездок (Telegram Mini App)

Монорепозиторий проекта **Edem** (аналог BlaBlaCar для Telegram Mini Apps). Приложение позволяет водителям предлагать поездки, а пассажирам — бронировать места, оставлять отзывы и просматривать историю своих поездок.

## 🌟 Основные возможности

- **Поиск поездок**: поиск с фильтрацией по городам, дате, цене и тегам, offset-пагинация (`page`/`limit`); собственные поездки исключаются из выдачи (при пустой странице клиент догружает следующие); уже отправившиеся поездки в выдачу не попадают.
- **Создание поездок**: для водителей с указанием цены, количества мест, тегов и комментария.
- **Бронирование мест**: пассажиры выбирают место и бронируют в активных поездках; защита от гонки броней на уровне БД (partial unique index + Serializable-транзакции).
- **Заявки пассажиров**: водитель подтверждает или отклоняет заявки, место удерживается в статусе `pending`.
- **Отзывы и рейтинги**: система рейтингов водителей и пассажиров, отзывы после начала или завершения поездки в обе стороны (пассажир → водитель и водитель → пассажир). Отзывы проходят модерацию: создаются в статусе `pending` и публикуются после одобрения администратором — публичные списки и рейтинг учитывают только опубликованные; автор получает уведомление об одобрении/отклонении и видит статус в «Мои отзывы» профиля. Текст отзыва — до 150 символов.
- **Уведомления**: персистентный in-app inbox + WebSocket-hint для foreground-клиентов (новая заявка, статус брони, отмена поездки, завершение) **и фоновая рассылка через Bot API** (outbox `NotificationDelivery`, утверждена 2026-09-14 — см. `docs/adr/telegram-notification-delivery.md`). Входящие постоянны независимо от настроек; отправка идёт, только если включён `TELEGRAM_DELIVERY_ENABLED` (дефолт `true`), задан `TELEGRAM_BOT_TOKEN` и есть согласие пользователя — иначе задача получает `skipped` с причиной (`channel_disabled` / `no_token` / `bot_blocked`). 429 → повтор по backoff 1m/5m/15m, максимум 3 попытки. Стоп согласия — команда `/stop` у бота или `PATCH /admin/users/:id/telegram-stop`. Старые записи чистятся по retention-окнам (прочитанные/непрочитанные inbox и терминальные доставки outbox); живые (`pending`/`processing`) не удаляются. Deep-link — allowlist маршрутов Telegram-приложения.
- **Управление автомобилями**: добавление и редактирование информации об авто для водителей.
- **Админ-панель** (`webapp/`): отдельное веб-приложение на React 19 + shadcn/ui — дашборд с метриками, пользователи (бан/разбан, сброс онбординга), поездки (отмена), брони (смена статуса), отзывы (модерация: одобрение/отклонение/удаление, фильтр по статусу), обратная связь (просмотр + ответ пользователю), жалобы (фильтр и moderation transitions), read-only настройки. Вход по статичному `ADMIN_TOKEN`, сессия — httpOnly cookie с JWT (12 ч).
- **Интеграция с Telegram**: авторизация через подписанную initData (HMAC-SHA256, TTL), dev-bypass только в Dev/Test, telegram-ui, WebSocket с auth первым сообщением.
- **Онбординг**: при первом входе — экраны согласия (соглашение + приватность, 14+). Показывается один раз: принятие сохраняет версию на бэкенде (`User.onboardingVersion`, завершение через `POST /api/v1/users/me/onboarding`); отказ ведёт на удаление данных. Админка может сбросить флаг (`PATCH /api/v1/admin/users/:id/onboarding-reset`).

## 📁 Структура монорепозитория

```edem/
├── telegram-app/                # Frontend: React + telegram-ui + Vite (Telegram Mini App)
│   ├── src/
│   │   ├── api/                 # HTTP-клиент (таймауты, Zod-валидация ответов) + API-запросы
│   │   ├── components/          # Компоненты интерфейса (+ ErrorBoundary, Onboarding, OfflineBanner)
│   │   ├── ui/                  # ФАСАД над telegram-ui: вид и a11y в одном месте
│   │   ├── hooks/               # Кастомные React-хуки
│   │   ├── pages/               # Страницы (поиск, поездки, брони, профиль, отзывы, поддержка, жалобы, настройки)
│   │   ├── providers/           # WebSocket-провайдер
│   │   ├── queries/             # TanStack Query-хуки
│   │   ├── router/              # Роутинг (react-router) + deep-links (startapp)
│   │   ├── store/               # Zustand сторы (auth/session)
│   │   ├── consts/ helpers/ types/ utils/
│   │   └── onboarding/          # Версионирование онбординга
│   └── vite.config.ts           # Vite build configuration
│
├── backend/                     # Backend: Hono + Prisma ORM + PostgreSQL
│   ├── prisma/
│   │   ├── schema.prisma        # Модели: User, RefreshToken, Notification, Car, Trip, City, RideRequest, Booking, Review, Report, Feedback
│   │   ├── migrations/          # Prisma-миграции: squashed init (полный слепок схемы + CHECK/partial-индексы raw SQL), далее инкрементальные
│   │   └── seed.ts              # Наполнение тестовыми данными (TG-пользователи, поездки, заявки, жалобы)
│   ├── src/
│   │   ├── auth/                # Telegram-авторизация (подпись initData HMAC+TTL), JWT + refresh-токены, admin JWT
│   │   ├── admin/               # Админ-API /api/v1/admin (login/session/logout, guard по httpOnly cookie, модерация, telegram-метрики)
│   │   ├── middleware/          # Rate limiting (вкл. лимит вебхука бота), sanitize (DOMPurify)
│   │   ├── bot/                 # Webhook Telegram-бота (POST /bot/webhook/:secret; /start,/stop → согласие tgChatJoinedAt)
│   │   ├── trips/               # Поездки (+ пагинация, статусы, авто-завершение)
│   │   ├── bookings/            # Бронирования (Serializable, P2002/P2034 → 409)
│   │   ├── reviews/             # Отзывы (Serializable, P2034 → retry → 503)
│   │   ├── rideRequests/        # Пассивные запросы «Ищу попутку» (лента спроса, матчинг с водителем)
│   │   ├── cities/              # Справочник точек (публичный suggest, админ-CRUD)
│   │   ├── notifications/       # Уведомления (курсорная пагинация, unreadCount)
│   │   ├── feedback/            # Обращения в поддержку + публичные апелляции
│   │   ├── reports/             # Жалобы пользователей + админ-разбор статусов
│   │   ├── client-errors/       # Приём клиентских ошибок (sendBeacon), дедуп/троттлинг
│   │   ├── users/               # Профили, авто, настройки уведомлений
│   │   ├── ws/                  # WebSocket (auth, рассылка событий, reaper)
│   │   ├── workers/             # Фон: авто-завершение поездок, outbox-диспетчер TG-доставки, retention-чистка уведомлений
│   │   ├── events/              # Типизированные доменные события → подписчик уведомлений
│   │   ├── services/            # Бизнес-сервисы (TG-доставка/отправка, wsManager, клиентские ошибки, метрики)
│   │   ├── serializers/         # Сериализация ответов
│   │   ├── utils/               # moscowTime, overlap, escapeLike, timingSafeEqual, Prisma-ошибки, Sentry-хелперы
│   │   ├── app.ts               # Hono-приложение (роуты /api/v1, security-заголовки, Telegram-only static)
│   │   ├── index.ts             # Серверный entry point (initSentry, graceful shutdown)
│   │   ├── db.ts                # pg driver-адаптер Prisma (DATABASE_URL)
│   │   ├── env.ts               # Валидация и дефолты переменных окружения
│   │   └── constants / errors / logger / metrics / sentry   # Общие хелперы и инфраструктура
│   ├── .env                     # Переменные окружения (dev)
│   └── .env.test                # Переменные окружения для тестов (отдельная БД edem_test)
│
├── webapp/                      # Админ-панель: React 19 + Vite 8 + Tailwind 4 + shadcn/ui + TanStack Router/Query
│   └── src/
│       ├── features/            # Секции: auth (вход), dashboard, users, trips, bookings, reviews, feedback, reports, cities, settings
│       ├── layouts/             # AdminLayout (сайдбар, кнопка «Выйти»)
│       ├── lib/                 # api-client (same-origin /api, 401 → редирект на /login)
│       └── routes.tsx           # TanStack Router: публичный /login + защищённые админ-роуты (проверка сессии)
│
├── e2e/                         # Telegram parity E2E (Playwright + Chromium), см. e2e/README.md
│
├── packages/
│   └── contracts/               # Общий пакет Zod-схем, DTO и WS-контрактов
│       ├── src/
│       │   ├── schemas/         # Zod-схемы сущностей (trip, user, booking, review, report, city, ws, admin, …)
│       │   ├── dto/             # Схемы входных/выходных DTO (вкл. paginated*-ответы, admin DTO)
│       │   └── __tests__/       # Юнит-тесты контрактов (Vitest)
│
├── scripts/                     # prod-rebuild.sh, smoke, bundle/format/token-check
├── docs/                        # API-справочник (docs/api) и ADR (docs/adr)
└── package.json                 # Корневой package.json (npm workspaces)
```

## 🚀 Команды разработки

### Запуск проекта (Фронтенд + Бэкенд)
```bash
npm install
cp backend/.env.example backend/.env
docker compose -f docker-compose.local.yml up -d
npm run dev
```
Команда параллельно запустит бэкенд на порту 3011 и Telegram-фронтенд из workspace `telegram-app` на порту 3012. Vite проксирует `/api`, включая WebSocket `/api/v1/ws`, на бэкенд. Порты можно изменить через `BACKEND_PORT`, `VITE_TG_PORT` и `VITE_API_TARGET`.

Backend читает `backend/.env`. Корневой `.env` предназначен для Docker Compose.

### Запуск админ-панели
```bash
npm run dev --workspace=webapp   # админ-панель на http://localhost:3013
```
Dev-сервер webapp проксирует `/api` на бэкенд (`:3011`), поэтому admin-cookie работают same-origin без настройки CORS. Вход — по `ADMIN_TOKEN` из `backend/.env` (пустой токен = панель выключена). В production проксируйте на одном домене и статику webapp, и `/api` на бэкенд (см. раздел деплоя).

Канонический workflow использует npm workspaces (`npm run`); рантайм везде — Node 22. Установка зависимостей — `npm ci` по `package-lock.json`.

### Запуск в Docker (бэкенд в контейнере)
```bash
docker compose up -d --build   # сборка и запуск db + backend (:3000) + webapp (админ-панель :3014)
docker compose -f docker-compose.local.yml up -d # локальный PostgreSQL (:5433)
docker compose stop backend    # остановить контейнер бэкенда (оставить БД)
```
Требуется корневой `.env` с переменными `POSTGRES_PASSWORD`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_HOSTS`, `CORS_ORIGINS` (образец — `.env.example`). Миграции применяются автоматически при старте контейнера. Reseed внутри контейнера:
```bash
docker compose exec -T backend npx tsx prisma/seed.ts   # сбрасывает ВСЕ таблицы
```
> У контейнера своя БД — сервис `db`. Хостовый dev-бэкенд (`npm run dev:backend` на :3011, которым кормится приложение на :3012) ходит в другую, `db-dev` на :5433. Данные, засеянные в контейнере, в приложении на :3012 не появятся — и наоборот.

#### Прод-сид вокруг конкретного пользователя

Не трогает чужие данные, в отличие от полного `db:seed`. Скрипт **только для прода**: гард в начале
файла роняет запуск без `NODE_ENV=production`, чтобы случайный прогон не затирал dev-стенд (там
другой пользователь и другой набор). Прогон на боевой БД **необратимо пишет данные** вокруг реального
юзера, поэтому идём по шагам.

0. **Собрать новый образ.** Скрипты сида (`backend/prisma/*.ts`) запекаются в образ backend
   (`Dockerfile`: `COPY … backend/prisma ./prisma`), поэтому без `git pull` + пересборки контейнер
   выполнит **старую** версию сида:
   ```bash
   git pull --ff-only
   sh scripts/prod-rebuild.sh
   ```
1. **Найти `SEED_USER_ID`** и посмотреть, что сид затронет у юзера. Важно: `car.upsert` создаст
   `Lada Vesta`, если у него нет машины, а `refreshRating` перезапишет `rating`/`reviewsCount`.
   ```bash
   docker compose exec -T db psql -U edem -d edem -c \
     "SELECT id, name, \"telegramUserId\", rating, \"reviewsCount\" FROM \"User\" WHERE \"deletedAt\" IS NULL ORDER BY \"createdAt\";"
   docker compose exec -T db psql -U edem -d edem -c \
     "SELECT * FROM \"Car\" WHERE \"userId\"='<uuid>'; SELECT count(*) AS cities FROM \"City\";"
   ```
2. **Бэкап** перед записью:
   ```bash
   docker compose exec -T db pg_dump -U edem -d edem -Fc > ~/edem-prod-$(date +%F-%H%M).dump
   ```
3. **Справочник городов** (идемпотентно, безопасно для прод; иначе «город «Вологда» отсутствует»):
   ```bash
   docker compose exec -T backend npx tsx prisma/seed-cities.ts
   ```
4. **Прогон** (`NODE_ENV=production` уже задан в образе, нужен только `SEED_USER_ID`):
   ```bash
   docker compose exec -T -e SEED_USER_ID=<uuid> backend npx tsx prisma/seed-user-trips.ts
   ```
   Идемпотентен: чистит и создаёт только свои id (`tp-*`/`t-bezz-*`), чужие данные не трогает.
   Ожидаемый финал — `[seed-user-trips] ok: 6 поездок (3 свои + 3 чужие), …`.
5. **Проверка** (заодно опции поездки: `t-bezz-1` → `autoComplete=t`, `t-bezz-2` → `matchingEnabled=f`):
   ```bash
   docker compose exec -T db psql -U edem -d edem -c \
     "SELECT id, status, \"autoComplete\", \"matchingEnabled\" FROM \"Trip\" WHERE id LIKE 't-bezz-%' OR id LIKE 't-tp-%' ORDER BY id;"
   ```
6. **Откат** (если прогон не нужен) — удалить свои id сида в FK-порядке:
   ```sql
   BEGIN;
   DELETE FROM "Notification" WHERE "userId"='<uuid>' AND title LIKE '%Bezz-тест%';
   DELETE FROM "Review"       WHERE id IN ('r-tp-1','r-tp-2','r-tp-3','r-tp-4');
   DELETE FROM "RideRequest"  WHERE id IN ('rr-tp-1','rr-tp-2','rr-tp-3','rr-tp-4','rr-tp-5');
   DELETE FROM "Booking"      WHERE "tripId" IN ('t-bezz-1','t-bezz-2','t-bezz-past-1','t-tp-1','t-tp-2','t-tp-past-1');
   DELETE FROM "Trip"         WHERE id IN ('t-bezz-1','t-bezz-2','t-bezz-past-1','t-tp-1','t-tp-2','t-tp-past-1');
   DELETE FROM "Car"          WHERE "userId" IN ('u-tp-d1','u-tp-d2','u-tp-p1','u-tp-p2');
   DELETE FROM "User"         WHERE id IN ('u-tp-d1','u-tp-d2','u-tp-p1','u-tp-p2');
   -- и, если авто юзеру создал сид (в пре-флайте его не было):
   -- DELETE FROM "Car" WHERE "userId"='<uuid>' AND model='Lada Vesta';
   COMMIT;
   ```
   Не восстановить автоматически: `rating`/`reviewsCount` юзера (`refreshRating` пересчитывает их по
   опубликованным отзывам) и созданную сидом машину — поэтому шаг 1 смотрит машину до прогона.

Для прод-пересборки используйте `scripts/prod-rebuild.sh`: инкрементальный Docker-кэш, ожидание `/health/ready` опросом (а не `sleep`), и любая красная проверка валит скрипт (`exit 1`) с диагностикой.
```bash
sh scripts/prod-rebuild.sh            # build + recreate + health (инкрементально)
sh scripts/prod-rebuild.sh --no-build # только пересоздать контейнеры (смена .env/лимитов)
sh scripts/prod-rebuild.sh --clean    # prune + build --no-cache (смена базы/платформы)
sh scripts/prod-rebuild.sh --smoke    # + scripts/smoke-telegram-deployment.mjs
```
`TG_HOST` для Host-проверки берётся из `TELEGRAM_HOSTS` (окружение или `.env`), переопределяется `TG_HOST=...`; таймаут готовности — `HEALTH_TIMEOUT` (дефолт 90с).

### Сборка приложения (включая общий пакет)
```bash
npm run build          # contracts → backend → telegram-app → webapp
npm run build:contracts  # только contracts
```

### База данных (Prisma 7)
```bash
npm run db:generate       # Сгенерировать Prisma Client (в backend/src/generated, gitignored)
npm run db:migrate        # Создать миграцию (dev) + пересоздать клиент
npm run db:migrate:deploy # Применить миграции к БД
npm run db:push           # prisma db push (только чистые БД без _prisma_migrations)
npm run db:push:force     # destructive push (--accept-data-loss) под prod-гардом
npm run db:test:push --workspace=backend  # то же для edem_test (guard + .env.test)
npm run db:seed           # Заполнить БД тестовыми данными (идемпотентно; dev/test only)
npm run db:seed:cities    # Только справочник городов (идемпотентно; безопасен для prod)
npm run db:seed:user      # Данные вокруг одного юзера: SEED_USER_ID=<id> npm run db:seed:user
npm run prisma:validate   # Валидация schema.prisma
```
`db:push:force` и `db:test:push` перед вызовом `prisma db push` прогоняют `backend/prisma/db-push-guard.ts`: при `NODE_ENV=production` скрипт падает с подсказкой, пока явно не задан `ALLOW_PRODUCTION_DB_PUSH=true`. Гард ловит случайный destructive push, который снёс бы боевые данные; обычный `db:push` (без `--accept-data-loss`) гарда не имеет.

Подключение — через pg driver-адаптер `@prisma/adapter-pg` (`backend/src/db.ts`): URL из `DATABASE_URL`. Конфигурация CLI — `backend/prisma.config.ts`. Сгенерированный клиент (`backend/src/generated/`) компилируется tsc в `dist`; после `git pull` с изменённой схемой выполните `npm run db:generate`. В Docker-образе исходников нет, поэтому скрипты из `backend/prisma/` находят клиент по симлинку `/app/src/generated → /app/dist/src/generated` (см. `backend/Dockerfile`).

Быстрый старт на свежей БД:
```bash
cd backend
npx prisma migrate deploy   # применить миграции (или npx prisma migrate reset --force)
npm run db:seed --workspace=backend
```

### Проверки и тесты
```bash
npm run typecheck        # tsc --noEmit во всех воркспейсах
npm run test             # Юнит-тесты (Vitest): contracts + backend + telegram-app + webapp
npm run lint             # алиас typecheck (typecheck всех воркспейсов)
npm run lint:eslint      # ESLint всего репо (TS + react-hooks + jsx-a11y)
npm run lint:eslint:backend  # только backend (аналогично :tg-app, :webapp, :contracts)
npm run format:check     # базовая проверка текстовых файлов и JSON без перезаписи
npm run token:check      # токены дизайна: нет литералов вне токенов
npm run bundle:check     # gzip-бюджет бандлов (telegram-app + webapp)
npm run build            # contracts → backend → telegram-app → webapp
node e2e/telegram-parity.mjs  # E2E parity (см. e2e/README.md; нужны backend :3011, TG-front :3012, dev-БД)
```

Тесты backend запускаются на отдельной БД `edem_test` (см. `backend/.env.test`), поэтому рабочая БД не затрагивается. При локальном Compose создайте её через `docker exec edem-db-dev psql -U edem -c "CREATE DATABASE edem_test;"`, затем выполните `npm run db:test:push --workspace=backend`. GitHub Actions поднимает PostgreSQL 16 с готовой `edem_test` автоматически и выполняет те же lint, format, build и test-проверки на Node 22.

## ⚙️ Настройка окружения

Для локального запуска бэкенда необходим файл `backend/.env`. Пример:

```env
DATABASE_URL="postgresql://user:password@host:port/db?schema=public"
NODE_ENV=development
ALLOW_DEV_AUTH=true            # Dev-bypass initData hash=dev-hash (только не в production); mock refresh-токены работают end-to-end
JWT_SECRET=your-jwt-secret-key-32-chars-long
TELEGRAM_BOT_TOKEN=            # Пусто в dev = dev-bypass; в production обязателен
TELEGRAM_WEBHOOK_SECRET=       # Секрет path вебхука бота; в dev эфемерный, в production обязателен
SENTRY_DSN=                    # Sentry DSN (пусто — Sentry выключен)
CORS_ORIGINS=http://localhost:3012
BACKEND_PORT=3011
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
TG_AUTH_RATE_WINDOW_MS=300000
TG_AUTH_RATE_MAX=5
REFRESH_RATE_WINDOW_MS=600000
REFRESH_RATE_MAX=10
ADMIN_TOKEN=                     # статичный токен админ-панели (пусто — панель выключена)
LOG_LEVEL=debug
```

Все числовые настройки должны быть положительными целыми числами. Ноль,
отрицательные, дробные и частично числовые значения останавливают запуск с
ошибкой конфигурации; отсутствующие переменные используют значения по умолчанию
из `backend/src/env.ts`. Полный список групп (auth, лимитеры, Bot API, outbox
уведомлений, client errors, метрики) с дефолтами — [`backend/ENVIRONMENT.md`](backend/ENVIRONMENT.md).

Для тестов — `backend/.env.test` с `DATABASE_URL`, указывающим на `edem_test`. Файл отслеживается в git и содержит только локальные тестовые значения; реальные секреты в него добавлять нельзя. Корневой `.env.example` предназначен для Docker Compose, а `backend/.env.example` — для локального backend.

## 🔌 API

Все REST-роуты находятся под префиксом **`/api/v1`**:

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/v1/auth/telegram` | Вход через Telegram initData (дефолт 5 req/5 мин, `TG_AUTH_RATE_*`) |
| POST | `/api/v1/auth/refresh` | Ротация refresh-токена; reuse → отзыв всех токенов (дефолт 10 req/10 мин, `REFRESH_RATE_*`) |
| POST | `/api/v1/auth/logout` | Отзыв refresh-токена |
| GET | `/api/v1/trips` | Список активных поездок (пагинация `{items, pagination}`); уехавшие поездки скрыты. Фильтры: `q`/`fromCity`/`toCity` ≤ 100 симв. (подстрока, LIKE-джокеры экранируются), `fromCityId`/`toCityId` (приоритет над именами), `dateFrom`/`dateTo` — московские сутки `YYYY-MM-DD`, `tags` ≤ 6, `maxPrice` 1..`MAX_TRIP_PRICE` (100000); невалидные даты/цена → 400 |
| GET | `/api/v1/trips/my?status=active\|archive` | Поездки текущего водителя (фильтр по статусу) |
| GET | `/api/v1/trips/:id` | Детали поездки (занятые места `bookedSeats` по DB-учёту — совпадают с `seatsAvailable`; `myBooking` — только живая бронь: истёкшая заявка прав участника не даёт) |
| POST | `/api/v1/trips` | Создание поездки (нужна машина, макс. `MAX_SEATS = 3` места, цена 1..`MAX_TRIP_PRICE` = 100000). Две опции владельца, обе **необязательны** и без них поведение прежнее: `autoComplete` (`false` — поездка «протухает» через 24ч после отправления, `true` — завершается по окончании рейса, точность не лучше часа: воркер идёт раз в час), `matchingEnabled` (`true` — подходящим попутчикам уходят уведомления и живые подсказки, `false` — не предлагаем вовсе) |
| PATCH | `/api/v1/trips/:id` | Редактирование поездки (в т.ч. **опций** `autoComplete`/`matchingEnabled` — водитель вправе передумать после публикации; отсутствие ключа флага означает «не трогать», а не «сбросить в дефолт» (нельзя уменьшить места ниже занятых; **маршрут** `fromCity/toCity` изменить нельзя — 400; уехавшую поездку редактировать нельзя — 409; смена времени проверяет брони пассажиров на пересечение) |
| PATCH | `/api/v1/trips/:id/cancel` | Отмена поездки |
| PATCH | `/api/v1/trips/:id/complete` | Завершение поездки (`?force=1` — только dev/test) |
| GET | `/api/v1/cities/suggest?q=&limit=` | Публичный справочник точек (автодополнение формы поездки; без auth, `q` опционален → весь список) |
| POST | `/api/v1/bookings` | Создание брони (гонка → 409 SEAT_TAKEN; уехавшая поездка → 400 TRIP_IN_PAST) |
| PATCH | `/api/v1/bookings/:id/status` | Подтвердить/отклонить pending-заявку до отправления |
| PATCH | `/api/v1/bookings/:id/cancel` | Отмена брони пассажиром |
| GET | `/api/v1/bookings/my` | Мои брони (пассажир) |
| GET | `/api/v1/bookings/history` | История броней |
| GET | `/api/v1/bookings/driver` | Активные поездки водителя вместе с заявками (экран «Водитель») |
| GET | `/api/v1/bookings/trip/:tripId` | Заявки по поездке (водитель) |
| GET | `/api/v1/notifications/my?cursor=&limit=` | Уведомления (курсорная пагинация, `unreadCount`) |
| GET | `/api/v1/notifications/unread-count` | Только счётчик непрочитанных (для бейджа таб-бара) |
| PATCH | `/api/v1/notifications/:id/read` | Отметить прочитанным |
| PATCH | `/api/v1/notifications/read-all` | Отметить все прочитанными |
| POST | `/api/v1/reviews` | Отзыв после поездки (пассажир → водитель или водитель → подтверждённый пассажир); создаётся `pending` — публикуется после одобрения модерацией, текст ≤ 150 символов |
| GET | `/api/v1/reviews/my` | Отзывы, оставленные текущим пользователем (все статусы; элемент включает `status`) |
| GET | `/api/v1/reviews/available-trips` | Поездки для отзыва (пассажир или водитель с подтверждёнными пассажирами) |
| GET | `/api/v1/reviews/user/:userId` | Публичный список отзывов о пользователе (только опубликованные) |
| GET | `/api/v1/users/me` | Текущий пользователь |
| PATCH | `/api/v1/users/me` | Обновление профиля |
| POST | `/api/v1/users/me/car` | Добавить автомобиль (та же логика, что у PATCH: upsert) |
| PATCH | `/api/v1/users/me/car` | Изменить автомобиль |
| DELETE | `/api/v1/users/me/car` | Удалить автомобиль (409 `ACCOUNT_HAS_ACTIVE_OBLIGATIONS`, пока есть активная поездка) |
| PATCH | `/api/v1/users/me/notification-settings` | Настройки уведомлений |
| POST | `/api/v1/users/me/onboarding` | Завершение онбординга: сохраняет версию (`{version}` — строка 1..50 символов) |
| GET | `/api/v1/users/:id` | Публичный профиль |
| POST | `/api/v1/feedback` | Обращение в поддержку (тема ≤ 100, текст ≤ 2000; санитизация, rate limit) |
| GET | `/api/v1/feedback` | Мои обращения с ответами поддержки (`reply`/`repliedAt`; новые первыми) |
| POST | `/api/v1/feedback/appeal` | Публичная апелляция забаненного (личность — по подписи initData, без выдачи токенов; лимит 5/час на IP) |
| POST | `/api/v1/client-errors` | Приём клиентских ошибок (`sendBeacon`; публичный, санитизация + дедуп + троттлинг; тело ≤ 16 KB, лимит 10/мин на IP) |
| POST | `/api/v1/ride-requests` | Создать пассивный запрос маршрута/временного окна (до 3 активных) |
| GET | `/api/v1/ride-requests` | Мои запросы «Ищу попутку» |
| GET | `/api/v1/ride-requests/feed` | Лента спроса для главной: агрегаты по маршрутам (люди, места, ближайшее окно), по спросу и без имён |
| GET | `/api/v1/ride-requests/matching` | Совместимые активные запросы для водителя; автоматическая бронь не создаётся |
| PATCH | `/api/v1/ride-requests/:id` | Изменить временное окно, места или срок действия |
| PATCH | `/api/v1/ride-requests/:id/status` | Поставить запрос на паузу/возобновить/завершить |
| DELETE | `/api/v1/ride-requests/:id` | Отменить пассивный запрос |
| POST | `/api/v1/reports` | Создать жалобу на связанного пользователя, поездку или бронь (окно: с начала поездки и 7 дней после её окончания; лимит: 1 жалоба навсегда на связку автор+объект — повтор → `409`) |
| GET | `/api/v1/reports` | Мои жалобы |
| GET | `/api/v1/reports/targets` | Объекты, доступные для жалобы (поездки, брони, люди с общей бронью в окне жалобы) — список для формы подачи |
| DELETE | `/api/v1/users/me` | Soft-delete и анонимизация профиля; операция каскадная (завершает свои поездки, отменяет будущие брони), отдельного гейта «есть обязательства» больше нет |
| POST | `/api/v1/admin/auth/login` | Вход админ-панели по `ADMIN_TOKEN` (5 req/5 мин, `ADMIN_LOGIN_RATE_*`); ставит httpOnly cookie `edem_admin_jwt` |
| GET | `/api/v1/admin/auth/session` | Состояние админ-сессии (всегда 200; httpOnly cookie недоступен JS) |
| POST | `/api/v1/admin/auth/logout` | Выход из админ-панели (очистка cookie) |
| GET | `/api/v1/admin/dashboard` | Метрики: пользователи, поездки, брони, отзывы, новые за 7 дней |
| GET | `/api/v1/admin/users` | Список пользователей (поиск `q`, пагинация) |
| PATCH | `/api/v1/admin/users/:id/ban` | Бан пользователя (`bannedAt` + обязательная причина `banReason` в теле `{ reason }`, 1–500 симв.); поездки не отменяются; открытые WS-соединения закрываются (4403) |
| PATCH | `/api/v1/admin/users/:id/unban` | Разбан |
| PATCH | `/api/v1/admin/users/:id/onboarding-reset` | Сброс флага онбординга (`onboardingVersion` → null): пользователь снова увидит экраны согласия |
| PATCH | `/api/v1/admin/users/:id/telegram-stop` | Стоп Bot API-рассылки пользователю: `tgChatJoinedAt → null` и живые задачи outbox → `skipped/admin_stopped` (атомарная транзакция, идемпотентно). Возвращает `{ success, hadConsent, cancelledDeliveries }` |
| GET | `/api/v1/admin/telegram/metrics` | JSON-агрегат outbox-доставок (`channelEnabled`, `total`, `pending`, `processing`, `delivered`, `failed`, `skipped` по причинам; без PII) |
| GET | `/api/v1/admin/trips` | Список поездок (фильтр `status`, пагинация) |
| PATCH | `/api/v1/admin/trips/:id/cancel` | Отмена поездки (только статус, без каскада); завершённые/отменённые — 409 |
| GET | `/api/v1/admin/bookings` | Список броней (фильтр `status`, пагинация) |
| PATCH | `/api/v1/admin/bookings/:id/status` | Смена статуса брони (pending/confirmed/declined/cancelled) с пересчётом мест; конфликты — 409 |
| GET | `/api/v1/admin/reviews` | Список отзывов (фильтр `?status=pending\|published\|rejected`, пагинация; элемент включает `status`) |
| PATCH | `/api/v1/admin/reviews/:id/approve` | Одобрение отзыва (pending → published, пересчёт рейтинга получателя, уведомление автору; 404/409) |
| PATCH | `/api/v1/admin/reviews/:id/reject` | Отклонение отзыва (pending → rejected, уведомление автору; 404/409) |
| DELETE | `/api/v1/admin/reviews/:id` | Удаление отзыва (из любого статуса, с пересчётом рейтинга цели) |
| GET | `/api/v1/admin/feedback` | Список обращений в поддержку (пагинация; элемент включает `reply`/`repliedAt`) |
| GET | `/api/v1/admin/feedback/:id` | Детальная карточка обращения (404, если нет) |
| POST | `/api/v1/admin/feedback/:id/reply` | Первичный ответ поддержки (создаёт уведомление; 400, если ответ уже есть) |
| PUT | `/api/v1/admin/feedback/:id/reply` | Редактирование ответа (не двигает `repliedAt`; 400, если ответа ещё нет) |
| GET | `/api/v1/admin/reports` | Список жалоб с фильтрами `status`/`targetType` и пагинацией |
| GET | `/api/v1/admin/reports/:id` | Детальная жалоба |
| PATCH | `/api/v1/admin/reports/:id/status` | Перевести жалобу в `in_review`, `resolved` или `rejected` |
| GET | `/api/v1/admin/cities` | Справочник точек (поиск `q`, пагинация) |
| POST | `/api/v1/admin/cities` | Создать точку (409 на дубликат имени) |
| PATCH | `/api/v1/admin/cities/:id` | Переименовать точку (409 на дубликат имени) |
| DELETE | `/api/v1/admin/cities/:id` | Удалить точку (409, если `tripsCount > 0`) |
| POST | `/api/v1/admin/cities/recompute-trips-count` | Полный пересчёт `City.tripsCount` по FK и статусу поездок; идемпотентно, чинит дрейф счётчика. Возвращает `{ updated }` |
| GET | `/api/v1/admin/settings` | Read-only снимок rate-limit'ов и флагов env |
| POST | `/bot/webhook/:secret` | Webhook Telegram-бота: `/start`/`/stop` → согласие на Bot API-рассылку (`tgChatJoinedAt`); секрет в path, IP-лимит `BOT_WEBHOOK_RATE_*` |
| GET | `/metrics` | Prometheus-метрики: Bearer `METRICS_TOKEN`, если задан; без токена в production — `404`, вне production открыт |
| WS | `/api/v1/ws` | WebSocket-события; access token отправляется первым auth-сообщением |
| GET | `/health`, `/health/live`, `/health/ready` | Проверки здоровья |

Все endpoint'ы `/api/v1/admin/*`, кроме `/auth/*`, требуют валидную админ-сессию (httpOnly cookie); без неё — **401**. При пустом `ADMIN_TOKEN` панель выключена: **403** на всё, включая логин. Подробности — в [`docs/api/admin.md`](docs/api/admin.md).

## 🔒 Безопасность

- **Sanitization**: все мутации проходят через `getSanitizedBody` (isomorphic-dompurify, без HTML-тегов) — защита от XSS.
- **Telegram-auth**: initData проверяется HMAC-SHA256 по `TELEGRAM_BOT_TOKEN` + TTL (`TG_INIT_DATA_TTL_SECONDS`); dev-bypass `hash=dev-hash` — только вне production при `ALLOW_DEV_AUTH` **и** только для id из `DEV_AUTH_USER_ALLOWLIST` (пустой список = dev-механизмы выключены). Подпись/форма вне TTL → 401, ненастроенный роут → 503.
- **Refresh-токены**: хранятся в БД хэшированными (SHA-256), одноразовые — при каждом `/refresh` старый отзывается, выдаётся новый (`rotateRefreshToken`, атомарный UPDATE с предикатом `revokedAt IS NULL` — из параллельных ротаций одного токена succeeds ровно одна). **Reuse detection**: предъявление уже ротированного токена отзывает ВСЕ активные токены пользователя (token family revocation); повторный `/logout` тем же токеном семью не отзывает.
- **Rate limiting**: раздельные лимитеры для `/auth/telegram`, `/auth/refresh` (`TG_AUTH_RATE_*`, `REFRESH_RATE_*`), логина админ-панели (`ADMIN_LOGIN_RATE_*`, анти-брутфорс), публичного чтения и мутаций (IP-based) и «дорогих» действий по аккаунту (user-based) — все настраиваются через ENV. Вебхук бота (`POST /bot/webhook/:secret`) лимитируется по IP (`BOT_WEBHOOK_RATE_WINDOW_MS`/`BOT_WEBHOOK_RATE_MAX`, дефолт 120/мин) — против флуда неверными секретами; секрет сравнивается timing-safe, неверный → `404` (не раскрываем существование эндпоинта). За reverse proxy обязательны `TRUST_PROXY=true` + перезапись `X-Real-IP`, иначе все клиенты делят один IP-бакет.
- **Админ-панель**: вход по статичному `ADMIN_TOKEN` (timing-safe сравнение); сессия — httpOnly cookie `edem_admin_jwt` с JWT (`type=admin-access`, `sub=admin`, TTL 12 ч): токен недоступен JS (защита от XSS), user-токены `type=access` админским guard'ом отклоняются. Панель закрыта по умолчанию: без `ADMIN_TOKEN` все запросы получают 403 в любой среде. Забаненные пользователи (`bannedAt`) получают 403 на всех аутентифицированных endpoint'ах; бан также применяется при логине в `/auth/telegram` (403 `{ code: "FORBIDDEN", banReason }` — токены не выдаются, активные refresh-токены отзываются), в `/auth/refresh` (403 + отзыв активных refresh-токенов), в `optionalAuth` (забаненный считается гостем) и в WebSocket-аутентификации (соединение закрывается с 4403), а при бане через админку открытые WS-соединения пользователя закрываются сразу. Mini-app при 403 `FORBIDDEN` показывает экран «Аккаунт заблокирован» с причиной бана (или «Причина не указана» для старых банов) и кнопкой «Обратная связь»: обращение уходит через публичный `POST /api/v1/feedback/appeal` (личность — по подписи initData, без выдачи токенов, лимит 5/час на IP) и видно в админке.
- **Гонка броней**: partial unique index `active_seat_booking` + Serializable-изоляция → второй запрос получает 409, а не некорректные данные.
- **Статусы брони**: только `pending → confirmed|declined`; отменённые, отклонённые и подтверждённые брони нельзя воскресить через водительский endpoint.
- **Отзывы**: Serializable-транзакция с одним ретраем при P2034; разрешены только направления пассажир → водитель и водитель → подтверждённый пассажир. Модерация: отзыв создаётся `pending` и становится публичным только после одобрения администратором; публичные списки и рейтинг (`rating`/`reviewsCount`) учитывают только `published` (пересчёт — при одобрении и удалении, не при создании).
- **Валидация**: Zod-схемы проверяют входы backend, критичные paginated-ответы fail closed при contract drift, а frontend валидирует API и WebSocket payloads.
- **Ошибки Prisma**: `P2025 → 404`, `P2034 → 409 { retryable: true }` маппятся централизованно в `app.onError` (страховка к локальным `catch`, чтобы гонка check-then-act не превращалась в 500). Неизвестные пути `/api/*` получают JSON `404 { code, message }`, а не SPA-fallback.
- **LIKE-джокеры**: пользовательский поиск (`q`, `fromCity`/`toCity`, справочник городов, поиск админа) экранируется (`escapeLike`: `\`, `%`, `_`), иначе `q=%` матчил бы любую строку и фильтр «проваливался» бы в выдачу всего.
- **Строгие схемы записи**: PATCH профиля/авто/настроек уведомлений и админские тела (ban, города, ответ поддержки) используют `.strict()` — лишние поля → `400`, а не тихий игнор.
- **Истечение заявок**: просроченный `pending` переводится в `declined` с возвратом места атомарно — глобальный sweep + адресный добор по поездке в той же Serializable-транзакции, что и `POST /bookings` (иначе чужой пассажир получал бы ложный `409 SEAT_TAKEN` на «мёртвой» строке).
- **Приватность**: публичные профили не содержат госномер, публичные поездки не раскрывают точные адреса встречи посторонним. Inbox-уведомления содержат только маршрут/статус; тела сообщений, токены и initData не логируются.
- **Заголовки**: `X-Content-Type-Options`, CSP `frame-ancestors 'self'`, `Referrer-Policy`, `Permissions-Policy`, HSTS (в production).
- **Ограничение тела запроса**: 100 KB.
- **Время**: даты сериализуются в `Europe/Moscow` (в контейнере задано через `TZ`).
- **Критичные уведомления** (смена статуса брони/поездки) создаются всегда, независимо от настройки `notificationsEnabled` пользователя.
- **Sentry (опционально, `SENTRY_DSN`)**: перед отправкой события очищаются от PII — `user` обнуляется, в `request` остаются только url/method, из `extra` вырезаются чувствительные ключи (token/password/secret/cookie и т.д.); без DSN хелперы деградируют в обычные логи.

## 📡 WebSocket

После авторизации клиент подключается к `/api/v1/ws` и отправляет `{ type: "auth", token }`. Токен не находится в URL. При аутентификации сервер проверяет пользователя в БД: забаненным соединения закрываются с кодом `4403`. Сервер рассылает события:
`booking:new`, `booking:status_changed`, `trip:status_changed`, `trip:details_changed`, `notification:new`, а также `ping` (keep-alive, клиент отвечает `pong`). Клиент автоматически реконнектится с exponential backoff и jitter, инвалидирует затронутые TanStack Query-запросы и показывает snackbar-уведомления.

Reaper (`startWsReaper`/`stopWsReaper`): каждые 30 с сервер закрывает соединения без pong дольше 60 с; остановка идемпотентна, «зомби»-тики после остановки не чистят соединения (graceful shutdown).

Размер кадра ограничен `wss.options.maxPayload` = 64 KB (дефолт библиотеки `ws` — 100 MiB; для мелких сообщений такого запаса достаточно, а огромный JSON на анонимном соединении — вектор флуда). При graceful shutdown сервер дожидается текущих циклов фоновых воркеров (trip-worker, notification-dispatcher) до закрытия сокетов.

## 🛠 Технологии

- **Frontend**: React 19, @tma.js/sdk-react (+ @tma.js/init-data-node на бэкенде), telegram-ui, Zustand, TanStack Query, react-router, Vite 8, Sentry
- **Админ-панель**: React 19, Vite 8, Tailwind CSS 4, shadcn/ui, TanStack Router + Query, lucide-react, sonner
- **Backend**: Hono, Node.js 22, Prisma ORM, PostgreSQL, jose (JWT), Zod, pino, @sentry/node, isomorphic-dompurify
- **Монорепозиторий**: npm workspaces, TypeScript, Vitest, ESLint (конфиг `eslint.config.mjs`)
- **E2E**: Playwright + Chromium — parity/realtime journeys + UI-гварды (каскад, контраст, рёбра): `e2e/`, см. `e2e/README.md`
- **CI**: GitHub Actions (checkout/setup-node v5, Node 22, PostgreSQL 16 как сервис)

## 🚀 Деплой (Production)

Архитектура: **всё на одном сервере** — бэкенд отдаёт API + статику (telegram-app/dist) + WebSocket. Внешний HTTPS-терминатор (Traefik/nginx) проксирует на backend:3000, а PostgreSQL наружу не публикуется. Детали (переменные, прокси, миграции) — в `docker-compose.yml` и `.env.example`.

Адрес публикации порта настраивается через `BACKEND_BIND_ADDR` в корневом `.env`:

- `127.0.0.1` (дефолт) — Traefik/nginx на том же хосте; прямой доступ извне исключён.
- `0.0.0.0` — Traefik/nginx на отдельном хосте; обязательно ограничьте TCP-порт `3000` firewall-правилами так, чтобы к нему обращался только Traefik/nginx.

```
Пользователь → Telegram (WebView) → https://<your-domain> → Traefik (443) → backend:3000
```

Прокси обязан: пробрасывать `Host` без изменений (Host-роутинг фронта), **перезаписывать** `X-Real-IP`/`X-Forwarded-For` на `$remote_addr` + `TRUST_PROXY=true` в бэкенде (иначе общий IP-бакет лимитеров), поддерживать `Upgrade` для `/api/v1/ws`.

### Известные ограничения перед production

- `GET /api/v1/bookings/trip/:tripId` и frontend используют cursor pagination; водительский экран подгружает следующие страницы по мере необходимости.
- Детали поездки и заявки водителя имеют отдельные loading/error/retry состояния; при отсутствии сети приложение явно предупреждает, что сохранённые данные могут быть устаревшими.
- Даты поездок и date-only фильтры нормализуются через фиксированный `Europe/Moscow`; формы сохраняют только несекретные черновики и очищают их после успешной отправки.
- Rate limiting и WebSocket fan-out хранят состояние в памяти процесса и не подходят для нескольких backend-инстансов без Redis/pub-sub или ограничения deployment до одного инстанса.

### Требования Telegram Mini Apps

- **HTTPS обязателен** в production (кроме localhost).
- InitData проверяется HMAC-SHA256 по `TELEGRAM_BOT_TOKEN` + TTL (`TG_INIT_DATA_TTL_SECONDS`, дефолт 3600); dev-bypass `hash=dev-hash` — только вне production при `ALLOW_DEV_AUTH`.
- Клиент передаёт initData ровно как её отдал Telegram (без пересортировки/перекодировки), иначе HMAC не сойдётся.
- Фоновая рассылка Bot API **реализована и включена по умолчанию**: гейт — `TELEGRAM_DELIVERY_ENABLED` (дефолт `true`), наличие `TELEGRAM_BOT_TOKEN` и согласие пользователя; мгновенное выключение — `TELEGRAM_DELIVERY_ENABLED=false`. Правила согласия, лимиты и backoff: `docs/adr/telegram-notification-delivery.md`.

### Preflight (перед выкатом)

1. Бэкап или проверенная точка восстановления PostgreSQL.
2. `docker compose config --quiet` — не печатать интерполированный вывод: в нём секреты.
3. `BACKEND_BIND_ADDR` и `WEBAPP_BIND_ADDR` — `127.0.0.1`, если reverse proxy на том же хосте. Если `0.0.0.0` — закройте порты 3000/3014 firewall-правилами, кроме адреса прокси.
4. `npm audit --omit=dev --audit-level=high`. Текущие транзитивные зависимости Prisma дают high; `npm audit fix --force` на выкате не запускать — он откатывает Prisma и требует отдельного изменения зависимостей.

### Шаги деплоя

1. **Собрать**:
   ```bash
   npm install
   npm run build        # contracts → backend (dist) → telegram-app (dist) → webapp (dist)
   ```
2. **Применить миграции**:
   ```bash
   npm run db:migrate:deploy
   ```
3. **Наполнить справочник городов** (только на свежей БД; полный
   `db:seed` в проде запрещён — он создаёт демо-пользователей и поездки):
   ```bash
   npm run db:seed:cities   # идемпотентно, админские города не трогает
   ```
4. **Запустить** (production):
   ```bash
   NODE_ENV=production PORT=3000 npm start
   ```
   Или через Docker: `docker compose up -d --build` (backend на :3000, админ-панель webapp на :3014, миграции применяются при старте). Для повторного деплоя — `sh scripts/prod-rebuild.sh` (см. «Запуск в Docker»).

Порядок: миграции → бэкенд → клиент (обратный порядок ломает экраны с поездками). Миграции Prisma **forward-only**: откат кода не откатывает схему. Откат релиза — вернуть предыдущий образ/коммит; схему чинить новой миграцией. `prisma migrate resolve --rolled-back` и ручной DROP в проде не применять.

### Переменные окружения (production)

| Переменная | Обязательна | Описание |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL (в Docker — `postgresql://edem:...@db:5432/edem`) |
| `JWT_SECRET` | ✅ | ≥ 32 символов (проверяется в production) |
| `TELEGRAM_BOT_TOKEN` | ✅ | Токен бота для валидации initData (compose требует) |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | Секрет в path `POST /bot/webhook/:secret` (timing-safe сравнение); при `NODE_ENV=production` пустой → падение старта |
| `TELEGRAM_HOSTS` | ✅ | Хост Telegram-фронта (compose требует) |
| `CORS_ORIGINS` | ✅ | Разрешённые origin (same-origin через прокси) |
| `NODE_ENV` | ✅ | `production` |
| `PORT` | — | По умолчанию 3000 |
| `TRUST_PROXY` | — | `true` за reverse proxy, который перезаписывает `X-Real-IP`/`X-Forwarded-For` |
| `SENTRY_DSN` | — | Мониторинг ошибок |
| `METRICS_TOKEN` | — | Bearer для `/metrics`; без токена в production `/metrics` отвечает 404 |
| `TELEGRAM_WEBAPP_URL` | — | Ссылка для кнопки «Открыть» в сообщениях бота; пусто — сообщение без кнопки |
| `TELEGRAM_API_PROXY` | — | SOCKS5-прокси для исходящих вызовов Bot API (в production обычно пусто) |
| `TELEGRAM_DELIVERY_ENABLED` | — | Kill-switch Bot API-рассылки (по умолчанию `true`) |
| `ALLOW_DEV_AUTH` | — | В production принудительно `false` |
| `ADMIN_TOKEN` | — | Статичный токен админ-панели; пусто — панель выключена. Задайте длинный случайный секрет |
| `ADMIN_JWT_TTL_SECONDS` | — | TTL админ-сессии (по умолчанию 43200 = 12 ч) |
| `BOT_WEBHOOK_RATE_WINDOW_MS` / `BOT_WEBHOOK_RATE_MAX` | — | IP-лимит вебхука бота (по умолчанию 60000 мс / 120 запросов) |

### WebSocket за Traefik/nginx

Прокси должен поддерживать upgrade (Traefik — из коробки). Клиент подключается к `wss://<host>/api/v1/ws`, JWT — первым `auth`-сообщением, анонимные сокеты закрываются кодом 4401.

### Админ-панель (production)

Входит в `docker-compose.yml`: сервис `webapp` (nginx со статикой `webapp/dist`, порт публикации **3014**, адрес — `WEBAPP_BIND_ADDR` из root `.env`, дефолт `127.0.0.1`). Встроенный nginx-конфиг (`webapp/nginx.conf`) отдаёт SPA с fallback на `index.html` и проксирует `/api` на `backend:3000` внутри docker-сети — httpOnly cookie `edem_admin_jwt` работает same-origin (`SameSite=Lax`, без `SameSite=None`).

Деплой:

1. Задайте в root `.env`: `ADMIN_TOKEN` (длинный случайный секрет, например `openssl rand -hex 32`) и `WEBAPP_BIND_ADDR` (`0.0.0.0`, если прокси на отдельном хосте — и откройте порт 3014 в firewall).
2. `docker compose up -d --build` — образ webapp собирается сам (multi-stage: vite build → nginx).
3. Внешний reverse proxy: домен админки (например, `admin.<your-domain>`) → `:3014`, проксировать **весь** трафик, включая `/api`.

`Secure`-флаг cookie определяется по `X-Forwarded-Proto` (nginx пробраскивает его от вышестоящего прокси, иначе — по схеме соединения): по HTTPS cookie ставится с `Secure`, по HTTP — без него, логин работает в обоих случаях. В dev ту же роль выполняет Vite-прокси (`webapp/vite.config.ts`, порт 3013).
