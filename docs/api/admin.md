# Admin API

Reports are available at `GET /api/v1/admin/reports`, `GET /api/v1/admin/reports/:id` and `PATCH /api/v1/admin/reports/:id/status`; see `docs/api/reports.md` for filters, state transitions and authorization.

Админ-API занимает префикс `/api/v1/admin` и управляется отдельной
админ-сессией (не пользовательской). Источник истины по коду:
`backend/src/admin/` (роутер, guard, сериализаторы) и
`packages/contracts/src/{schemas,dto}/admin.*.ts`.

## Авторизация

Модель: статичный `ADMIN_TOKEN` (env бэкенда) обменивается на короткоживущий
JWT в httpOnly cookie. Пользовательские роли не используются.

- `ADMIN_TOKEN` пуст/не задан → панель **выключена**: `403` на все запросы
  `/api/v1/admin/*`, включая логин, в любой среде.
- Сессия — cookie `edem_admin_jwt`: JWT (HS256, `JWT_SECRET`) с клеймами
  `type=admin-access`, `sub=admin`, `jti`, TTL = `ADMIN_JWT_TTL_SECONDS`
  (по умолчанию 43200 = 12 часов). Атрибуты cookie: `HttpOnly; SameSite=Lax;
  Path=/; Max-Age=<TTL>` (+ `Secure` в production). Refresh-токенов нет:
  по истечении TTL — повторный логин.
- Guard: нет cookie или JWT невалиден/просрочен/другого типа → `401`.
  Пользовательский access-токен (`type=access`) админским не считается.
- Логин защищён IP-rate-limit'ом `ADMIN_LOGIN_RATE_*` (по умолчанию 5 попыток
  за 5 минут) — анти-брутфорс.

### POST /api/v1/admin/auth/login

Вход по статичному токену. Публичный (без сессии), rate-limited.

Тело:

```json
{ "token": "статичный ADMIN_TOKEN" }
```

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `{ "expiresAt": 1787774612000 }` | Успех; `Set-Cookie: edem_admin_jwt=<JWT>` |
| 400 | `VALIDATION_FAILED` | Невалидное тело (нет `token`, пустой, > 512 символов) |
| 401 | `UNAUTHORIZED` | Неверный токен |
| 403 | `FORBIDDEN` | `ADMIN_TOKEN` не задан (панель выключена) |
| 429 | `RATE_LIMITED` | Превышен лимит попыток |

### GET /api/v1/admin/auth/session

Состояние сессии для фронтенда (httpOnly cookie недоступен JS). Публичный.
**Всегда 200**:

```json
{ "authenticated": true, "expiresAt": 1787774612000 }
```

`expiresAt` — epoch ms; когда сессии нет — `{ "authenticated": false, "expiresAt": null }`.

### POST /api/v1/admin/auth/logout

Очистка cookie (`Set-Cookie: edem_admin_jwt=; Max-Age=0`). Идемпотентен.
Ответ: `{ "ok": true }`. JWT stateless — серверного отзыва нет.
Лимитируется общим `mutationLimiter` (как остальные мутации), чтобы
logout не стал каналом флуда.

## Защищённые endpoint'ы

Все требуют валидную админ-сессию (cookie). Общие ошибки: `401 UNAUTHORIZED`
(нет/невалидна сессия), `403 FORBIDDEN` (панель выключена), `404 NOT_FOUND`
(сущность не найдена), `400 VALIDATION_FAILED` (невалидные query/тело).

Списочные endpoint'ы возвращают `{ items, total, page, pageSize }`
(offset-пагинация; `pageSize` ≤ 100, `page` ≤ 10000). Даты — ISO 8601 (UTC).

### GET /api/v1/admin/dashboard

Сводные метрики:

```json
{
  "totalUsers": 22,
  "totalTrips": 31,
  "activeTrips": 19,
  "totalBookings": 40,
  "totalReviews": 19,
  "newUsersLast7Days": 22
}
```

### GET /api/v1/admin/users

| Параметр | Тип | Описание |
|----------|-----|----------|
| `q` | string | Поиск по имени (без учёта регистра), опционально |
| `page` | number | default 1 |
| `pageSize` | number | default 20, max 100 |

Элемент `items`: `id, name, avatar, rating, tripsCount, reviewsCount,
isVerified, bannedAt (ISO|null), banReason (string|null),
createdAt (ISO)`. `banReason` — причина бана; `null` для банов, выставленных
до появления поля (клиент показывает «Причина не указана»).

### PATCH /api/v1/admin/users/:id/ban

Ставит `bannedAt = now` и сохраняет обязательную причину `banReason`.
Тело запроса: `{ "reason": string }` — обрезается по краям, 1–500 символов,
лишние поля отклоняются (строгая схема). Невалидное тело (нет причины,
пустая/пробельная строка, >500 символов, лишние поля) → `400
{ code: "VALIDATION_FAILED", message, errors }`. Повторный бан
идемпотентен: перезаписывает и метку времени, и причину. Поездки
пользователя **не** отменяются (осознанно). Забаненный пользователь
получает `403 { code: "FORBIDDEN", message: "Account is banned",
banReason }` от `requireAuth` на всех аутентифицированных endpoint'ах,
а также при логине (`/auth/telegram` — токены не выдаются, активные
refresh-токены отзываются) и в `/auth/refresh`; сервис сразу закрывает
все открытые WebSocket-соединения пользователя (код `4403`) и
отклоняет WS-аутентификацию (проверка `bannedAt` в БД при
`auth`-сообщении). Ответ — обновлённый user DTO.

### PATCH /api/v1/admin/users/:id/unban

Очищает `bannedAt` и `banReason` (`null`). Ответ — обновлённый user DTO.

### PATCH /api/v1/admin/users/:id/onboarding-reset

Сбрасывает флаг онбординга пользователя: ставит `onboardingVersion = null`
(идемпотентно: сброс уже пустого флага просто возвращает пользователя).
При следующем запуске приложения пользователь снова увидит слайды
онбординга — клиент сравнивает сохранённую версию со своей константой
`ONBOARDING_VERSION` и показывает слайды при несовпадении. Ответ —
обновлённый user DTO.

### PATCH /api/v1/admin/users/:id/telegram-stop

Мгновенный стоп Bot API-рассылки конкретному пользователю (SLA на жалобы
о спаме — 24 часа; см. `docs/adr/telegram-notification-delivery.md`). Сбрасывает
согласие `User.tgChatJoinedAt = null` **и** переводит все живые задачи
outbox (`NotificationDelivery` в статусе `pending`/`processing`) в
`skipped` с `error: "admin_stopped"` — в одной транзакции. Следующий тик
диспетчера видит чат=null и пропускает остальное, поэтому стоп мгновенный
без кэша. Идемпотентен: повторный стоп при пустом согласии — `200`.

Тело не требуется. Ответ:

```json
{ "success": true, "hadConsent": true, "cancelledDeliveries": 3 }
```

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `{ success, hadConsent, cancelledDeliveries }` | Успех (в т.ч. повторный вызов) |
| 404 | `NOT_FOUND` | Пользователь не найден |

### GET /api/v1/admin/telegram/metrics

JSON-агрегат outbox-доставок для админ-панели: `channelEnabled`
(kill-switch), `total`, `pending`, `processing`, `delivered`, `failed` и
`skipped` в разбивке по причинам. Те же цифры, что в `/metrics`
(Prometheus), но структурированные; только счётчики, без PII.

### GET /api/v1/admin/trips

| Параметр | Тип | Описание |
|----------|-----|----------|
| `status` | `active\|completed\|cancelled` | Фильтр, опционально |
| `page`, `pageSize` | number | как у `/users` |

Элемент `items`: `id, fromCity, toCity, fromAddress, toAddress, price,
seatsTotal, seatsAvailable, status, departureAt, createdAt, driverName,
driverId`.

### PATCH /api/v1/admin/trips/:id/cancel

Ставит `status = cancelled`. Только смена статуса: брони, места и уведомления
не трогаются (в отличие от водительской отмены с каскадом). Завершённые
(`completed`) и уже отменённые поездки отклоняются с `409 TRIP_NOT_ACTIVE`
(отмена завершённой поездки — невалидный переход: пассажиры теряют право
на отзыв при сохранении `tripsCount`). Ответ — trip DTO.

### GET /api/v1/admin/bookings

| Параметр | Тип | Описание |
|----------|-----|----------|
| `status` | `pending\|confirmed\|declined\|cancelled` | Фильтр, опционально |
| `page`, `pageSize` | number | как у `/users` |

Элемент `items`: `id, seat, status, createdAt, tripId, tripRoute,
passengerId, passengerName`.

### PATCH /api/v1/admin/bookings/:id/status

Тело: `{ "status": "pending" | "confirmed" | "declined" | "cancelled" }`.
Выполняется в Serializable-транзакции (как водительский endpoint) и
согласует места: переход активной брони (`pending`/`confirmed`) в
`declined`/`cancelled` возвращает место (`seatsAvailable + 1`, не выше
`seatsTotal`), обратный переход в активный статус повторно удерживает
место (`409`, если мест нет). Конфликты уникальных индексов (`P2002`)
возвращают `409` (`SEAT_TAKEN`/`ALREADY_BOOKED`/`BOOKING_CONFLICT`),
serialization-конфликт (`P2034`) — `409` с retry. Ответ — booking DTO.

### GET /api/v1/admin/reviews

| Параметр | Тип | Описание |
|----------|-----|----------|
| `status` | `pending\|published\|rejected` | Фильтр по статусу модерации, опционально |
| `page`, `pageSize` | number | как у `/users` |

Элемент `items`: `id, rating, text, targetRole, status, tripRoute,
createdAt, authorId, authorName, targetUserId, targetUserName`.
`status` — статус модерации: `pending` (на модерации), `published`
(опубликован), `rejected` (отклонён).

### DELETE /api/v1/admin/reviews/:id

Hard delete отзыва из любого статуса (внешних ссылок на Review нет,
каскад не нужен). Выполняется в Serializable-транзакции: в той же
транзакции пересчитываются `rating` и `reviewsCount` целевого пользователя
по оставшимся **опубликованным** отзывам (общий helper
`recomputeUserRating`) — удалённый отзыв перестаёт влиять на рейтинг.
Concurrent-конфликт сериализации (`P2034`) → `409` с retry. Ответ:
`{ "ok": true, "id": "<id>" }`.

### PATCH /api/v1/admin/reviews/:id/approve

Одобрение отзыва: `pending` → `published`. Отзыв становится публичным и
начинает учитываться в рейтинге получателя — `rating`/`reviewsCount`
пересчитываются (общий helper `recomputeUserRating`) в той же
Serializable-транзакции, что и смена статуса. Создаёт in-app уведомление
`review_approved` автору («Отзыв опубликован», deep-link в «Мои отзывы»;
не критичное — подчиняется тумблеру `notificationsEnabled`). Тело не
требуется.

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `AdminReviewDto` | Успех: статус `published`, рейтинг пересчитан, автор уведомлён |
| 404 | `NOT_FOUND` | Отзыв не найден |
| 409 | `CONFLICT` | Статус не `pending` (повторное одобрение или одобрение отклонённого) |

### PATCH /api/v1/admin/reviews/:id/reject

Отклонение отзыва: `pending` → `rejected`. Отклонённый отзыв скрыт из
публичного списка. `rating`/`reviewsCount` **не** пересчитываются:
pending-отзыв в рейтинг никогда не учитывался. Создаёт in-app
уведомление `review_rejected` автору («Отзыв отклонён», deep-link в
«Мои отзывы»; не критичное). Тело не требуется.

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `AdminReviewDto` | Успех: статус `rejected` |
| 404 | `NOT_FOUND` | Отзыв не найден |
| 409 | `CONFLICT` | Статус не `pending` (повторное отклонение или отклонение опубликованного) |

### GET /api/v1/admin/feedback

Список обращений пользователей в поддержку (новые первыми).
`page`, `pageSize` — как у `/users`. Элемент `items`: `id, subject, text,
reply (string|null), repliedAt (ISO|null), createdAt, userId, userName`.
`reply === null` — админ ещё не ответил.

Обращения создаются пользователями через `POST /api/v1/feedback`
(авторизованные) и `POST /api/v1/feedback/appeal` (забаненные, без токена —
личность по подписи Telegram initData); см. `docs/api/feedback.md`.

### GET /api/v1/admin/feedback/:id

Детальная карточка обращения (полный текст + ответ админа, если есть).
Ответ — один элемент в том же формате, что и элемент списка.
`404 NOT_FOUND` для несуществующего id.

### POST /api/v1/admin/feedback/:id/reply

Первичный ответ админа на обращение. Создаёт in-app уведомление
`feedback_replied` пользователю (deep-link в «Мои обращения») и ставит
`repliedAt = now` (аудит первичного ответа).

Первичный ответ фиксируется атомарным claim'ом
(`updateMany ... WHERE reply IS NULL`): при гонке двух ответов выигрывает
ровно один, второй получает `400` и не перезатирает первый (уведомление
создаётся только победителем).

Тело: `{ "reply": string }` (trim, 1–2000).

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `AdminFeedbackDto` | Успех (ответ сохранён, уведомление создано) |
| 400 | `VALIDATION_FAILED` | Невалидное тело; **или** ответ уже есть (используйте PUT) |
| 404 | `NOT_FOUND` | Обращение не найдено |

### PUT /api/v1/admin/feedback/:id/reply

Изменить/перезаписать существующий ответ. **Не двигает** `repliedAt`
(аудит «когда был дан ответ» сохраняется).

Тело: `{ "reply": string }` (trim, 1–2000).

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `AdminFeedbackDto` | Успех (ответ обновлён) |
| 400 | `VALIDATION_FAILED` | Невалидное тело; **или** ответа ещё нет (используйте POST) |
| 404 | `NOT_FOUND` | Обращение не найдено |

### GET /api/v1/admin/cities

Справочник точек для автодополнения в форме создания/редактирования
поездки. Источник правды для UI/поиска/уведомлений — `Trip.fromCity`/
`toCity` (строки), FK `Trip.fromCityId`/`toCityId` используются для
аналитики и autocomplete. Админ может дополнять справочник, удалять
неиспользуемые точки; водитель при создании поездки обязан выбрать
точку из справочника (free-text в форме отключён).

Query: `q` (поиск по подстроке, case-insensitive, до 100 символов),
`page` (default 1), `pageSize` (default 50, max 200).

200:

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Вологда",
      "tripsCount": 12,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-02-01T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 25, "totalPages": 1, "hasMore": false }
}
```

### POST /api/v1/admin/cities

Создать новую точку справочника. Дубликат имени (с учётом
trim + lower-case) → `409`.

Тело: `{ "name": "  Точное имя  " }` (1..100 символов, trim внутри
сервера, лишние пробелы схлопываются).

| Код | Ответ | Описание |
|-----|-------|----------|
| 201 | `AdminCityDto` | Успех |
| 400 | `VALIDATION_FAILED` | Пустое/слишком длинное имя |
| 409 | `CONFLICT` | Имя уже есть (другой регистр/пробелы считаются) |

### PATCH /api/v1/admin/cities/:id

Переименовать. Семантика конфликта имён — как у POST. `tripsCount`
остаётся прежним (FK не сбрасывается, история поездок не меняется).

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `AdminCityDto` | Успех |
| 400 | `VALIDATION_FAILED` | Невалидное имя |
| 404 | `NOT_FOUND` | ID не найден |
| 409 | `CONFLICT` | Дубликат имени |

### DELETE /api/v1/admin/cities/:id

Удалить точку. Запрещено, если на город ссылается хотя бы одна
поездка (`tripsCount > 0` — денормализованный счётчик, инкремент
при создании Trip, декремент при смене FK через PATCH). FK в Trip
при `ON DELETE SET NULL` сработал бы, но мы блокируем удаление на
уровне приложения, чтобы админ явно пересмотрел историю.

| Код | Ответ | Описание |
|-----|-------|----------|
| 200 | `{ "ok": true, "id": "..." }` | Успех |
| 404 | `NOT_FOUND` | ID не найден |
| 409 | `CONFLICT` | `tripsCount > 0`; в `message` — количество поездок |

### GET /api/v1/admin/settings

Read-only снимок текущих rate-limit'ов и флагов из env (записи нет,
управление — через переменные окружения):

```json
{
  "createTripRateMax": 10,
  "cancelTripRateMax": 20,
  "createBookingRateMax": 20,
  "cancelBookingRateMax": 20,
  "publicReadRateMax": 100,
  "mutationRateMax": 30,
  "allowDevAuth": true,
  "isProduction": false,
  "trustProxy": false
}
```

## Пример (curl)

```bash
# Логин (cookie сохраняется в jar)
curl -c cookies.txt -X POST http://localhost:3011/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"token":"<ADMIN_TOKEN>"}'

# Запрос с сессией
curl -b cookies.txt http://localhost:3011/api/v1/admin/dashboard

# Выход
curl -X POST http://localhost:3011/api/v1/admin/auth/logout
```

## Админ-панель (webapp)

Фронтенд панели — workspace `webapp/` (dev: `npm run dev --workspace=webapp`,
порт 3013, Vite-прокси `/api` → бэкенд). Страница `/login` принимает только
`ADMIN_TOKEN`; route-guard опрашивает `/auth/session`; при `401` от любого
endpoint'а клиент редиректит на `/login`. В production статика панели и `/api`
должны обслуживаться на одном домене (same-origin для cookie).
