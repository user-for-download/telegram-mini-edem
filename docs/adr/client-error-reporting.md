# ADR: Client error reporting via Telegram

**Status:** Accepted (2026-09-30)
**Date:** 2026-09-30
**Scope:** telegram-app (WebView) + backend (`/api/v1/client-errors`)

## Decision

Ошибки клиента собираем собственным каналом вместо Sentry на фронте:
`reportError` (sendBeacon) → публичный `POST /api/v1/client-errors` →
санитайзинг + дедупликация + троттлинг → pino-лог всегда, алерты в
Telegram-группу при настроенном `ERROR_ALERT_CHAT_ID`. `@sentry/react`
удалён с фронта; бэкендный `@sentry/node` оставлен (без DSN спит).

## Контракт

`POST /api/v1/client-errors`, публичный (ошибки бывают до авторизации),
ответ `204`, когда тело принято. Схема `clientErrorSchema`
(`packages/contracts`): `kind` = `error | unhandledrejection | boundary`;
`message` ≤ 500, `stack` ≤ 4000, `componentStack` ≤ 1000, `route` ≤ 200,
`release` ≤ 40 (релиз — `__APP_VERSION__` из сборки, отдельной
`VITE_RELEASE` нет). User-Agent берётся на сервере из заголовка.

## Защита публичного эндпоинта

- Свой `bodyLimit` 16 KB (поверх глобальных 100 KB), лимитер
  `createRateLimiter` 10 req/мин с IP (`keyPrefix: "client-errors"`).
  Замечание: лимитер видит реальный IP только при корректном
  `TRUST_PROXY`, иначе все пользователи — один бакет.
- Тело читается через `c.req.text()` + `JSON.parse` в `try/catch`
  (sendBeacon шлёт `text/plain`); невалид → `400` без стектрейсов.
- Санитайзинг (данным из браузера не доверяем): query-строки,
  `tgWebAppData`, `hash=`, JWT (`eyJ…`), длинные hex — из message, stack,
  route, componentStack.
- Отпечаток `sha1(kind + message + первый кадр без номеров строк)`:
  первое появление — алерт сразу, повторы — не чаще раза в 30 минут
  с пометкой «×N»; Map ограничен 200 записями.
- Глобальный потолок 20 алертов/час — главная защита от засыпания
  уникальными сообщениями в обход дедупликации; остальное считается
  и раз в час уходит одной сводкой «пропущено N».
- Текст алерта — plain text без `parse_mode`, ≤ ~1000 символов, без IP.
  Отправка fire-and-forget через `sendTelegramMessage` с `.catch`;
  `rate_limited` от Bot API — пропуск алерта + запись в лог.

## Клиент

- `reportError(error, extra)`: локальный дедуп (минута, ≤ 50 записей),
  `navigator.sendBeacon`, fallback `fetch(keepalive)`. В dev — только
  `log()`, без отправки.
- `initErrorReporting()` в `main.tsx` до рендера: слушатели `error` и
  `unhandledrejection` (ловят и сбои инициализации).
- Фильтр шума (не отправлять): `ResizeObserver loop`, `Script error.`,
  стеки `chrome-extension://` / `moz-extension://`, `AbortError`,
  ожидаемые `ApiError` 4xx (их обрабатывает UI).
- `ErrorBoundary.componentDidCatch` → `reportError` с `kind: "boundary"`
  и `componentStack`.

## Env

- `CLIENT_ERRORS_ENABLED` (default `true`; `false` — приём и лог без
  алертов), `ERROR_ALERT_CHAT_ID` (пусто = только лог; id группы
  отрицательный), `CLIENT_ERRORS_RATE_WINDOW_MS` / `CLIENT_ERRORS_RATE_MAX`
  через `positiveIntEnv`, chat id — через `chatIdEnv` (знак разрешён).

## Осознанные компромиссы

- Серверные 5xx идут в тот же канал: `app.onError` вызывает
  `reportServerError` с `kind: "server"` (backend-only вид контракта);
  4xx `onError` не триггерят и остаются тихими.
- Нет source maps и группировки — при желании позже подключается
  Bugsink без переделки канала.
- In-memory лимитер и троттлинг — один инстанс; масштаб это не меняет.
