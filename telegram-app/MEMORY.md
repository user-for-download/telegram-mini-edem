# telegram-app — MEMORY

> Onboarding-память для следующего агента. Цель: прочитать этот файл и сразу
> понимать устройство, инварианты, конвенции и подводные камни `telegram-app/`,
> не переоткрывая кодовую базу. Актуально на 2026-10-01.
>
> Дополняет, не заменяет: корневой `README.md`, `src/ui/README.md`.
> Исторические migration-доки удалены из дерева — смотри git (бывший
> `docs/migration/`). Источник истины по пропсам кита — установленный
> `node_modules/@telegram-apps/telegram-ui/dist/**/*.d.ts` (не docs, не train-дата).

---

## 1. Что это

`telegram-app/` — Telegram Mini App (TWA) сервиса попутчиков «Едем».
Отдельный workspace корневого монорепо `edem` (npm workspaces: `telegram-app`,
`backend`, `webapp`, `packages/*`).

Приложение открывается внутри Telegram WebView: полноэкранный, свой скролл,
нативный хром рисует клиент. Это диктует всё: HashRouter, безопасные зоны,
отсутствие PWA, `base: './'`.

## 2. Стек и пины

| Слой | Пакет | Версия | Замечание |
|---|---|---|---|
| UI-кит | `@telegram-apps/telegram-ui` | **2.1.13 (пин)** | пропсы сверять только по `dist/**/*.d.ts`; версия запинена тестом `src/__tests__/kitContract.test.tsx` |
| Telegram SDK | `@tma.js/sdk-react` | **3.0.23 (пин)** | скоуп `@tma.js/*` — устаревший; канонический по докам `@telegram-apps/sdk-react` (см. Findings) |
| Фреймворк | React | 19.0.1 | `StrictMode` (double-mount учтён везде) |
| Роутер | react-router-dom | 7.x | **HashRouter** — обязательно для WebView/deep links |
| Сборка | Vite | 8.x (Rolldown) | `codeSplitting.groups` вместо `manualChunks`; `base: './'` |
| TS | typescript | 5.8 | `strict` + `noUncheckedIndexedAccess` + `isolatedModules` |
| Состояние сервера | `@tanstack/react-query` | 5.x | один `QueryClient` в `AppConfig.tsx` |
| Состояние клиента | `zustand` | 5.x | только `useAuthStore` (и мелкие) |
| Валидация | `zod` | 4.x | ответы API и WS через `@edem/contracts` |
| Иконки | `lucide-react` | | размеры 28/30px, `strokeWidth={2}` |
| Тесты | `vitest` + `@testing-library/react` + `jsdom` | | **нет setup-файла** — мок-конфиг per-file |
| Tailwind | — | | **не используется**; только tgui + CSS-модули |

## 3. Команды

```bash
# из корня репо
npm run dev                       # build:contracts + db:generate + backend:3011 + tg:3012
npm run dev:tg                    # только telegram-app (Vite :3012)
npm run build:tg                  # прод-сборка telegram-app
npm run typecheck --workspace=telegram-app
npm run test --workspace=telegram-app
npm run lint:eslint:tg-app
npm run bundle:check              # бюджет бандла (scripts/check-bundle.mjs)
npm run token:check               # запрет литералов цветов/паддингов (scripts/token-lint.mjs)
npm run format:check
```

Backend по умолчанию `http://127.0.0.1:3011`, Vite проксирует `/api` → `VITE_API_TARGET`.
Прод API — `VITE_API_URL` (если не same-origin). Разрешённые Host-хосты — `VITE_ALLOWED_HOSTS` (через запятую).

## 4. Boot-lifecycle (ИНВАРИАНТ, не ломать)

`main.tsx:24-45` → `App.tsx:7-13`:

```
retrieveLaunchParams → await init() → render(<App/>) → post-mount useEffect → signalAppReady()
```

- `signalAppReady()` (`miniApp.ready`) живёт **только** в post-mount `useEffect` в `App.tsx`.
  Перенос к `await init()` погасит скелетон Telegram поверх пустого WebView.
- `init()` (`init.ts`) порядок: `setDebug` → `initSDK` → macOS-моки → mount
  (`backButton`, `settingsButton`, `closingBehavior`, `swipeBehavior`+`disableVertical`,
  `initData.restore`) → `themeParams.mount`+`bindCssVars` → `miniApp.mount` →
  `viewport.mount`+`bindCssVars`+`expand`.
- `viewport.mount` — единственный `BetterPromise` (await); остальные mount синхронны.
- Падение `retrieveLaunchParams`/`init` → рендер `EnvUnsupported` (не в Telegram).
- `swipeBehavior.disableVertical()` — глобально: иначе свайп вниз сворачивает апп.

## 5. Dev вне Telegram

`mockEnv.ts` (только `import.meta.env.DEV`, tree-shaken в проде):
- `isTMA("complete")` — если не TMA, ставится `mockTelegramEnv` с theme/viewport/
  safe-area/fullscreen-ответами и фейковой initData (`hash: "dev-hash"`, user id 9800001).
- `markTelegramMockEnv()` взводит window-флаг `__TG_ENV_MOCKED__`; UI через
  `isTelegramMockEnv()` (`utils/telegram-adapter.ts`) пропускает нативные диалоги
  (мок не рисует `popup.show`, хотя `isAvailable()` врёт `true`).
- `dev-hash` принимает backend только при `ALLOW_DEV_AUTH` (см. backend
  `src/auth/telegramSign.ts`). В проде вне Telegram — `EnvUnsupported`.
- Мобильный dev требует HTTPS с валидным сертификатом (туннель); self-signed/mkcert
  ломается на iOS/Android.

## 6. Слоение и правила импортов (закреплено ESLint)

`eslint.config.mjs`:
- Страницы/компоненты импортируют **`@/ui/*`**, не tgui напрямую.
- `no-restricted-imports` запрещает прямой импорт из кита имён
  `Button`, `IconButton`, `Card`, `List`, `Cell`, `Section` (у всех есть
  обёртки; `Page` заменяет `List`). `Cell` добавлен 2026-10-01 вместе с
  фасадом `ui/Cell`, `Section` — 2026-10-02 вместе с `ui/Section`. Компоновочные
  примитивы (`Text`, `Caption`, `Title`, `Headline`, `Avatar`, `Skeleton`,
  `Spinner`, `Input`, `Textarea`, `Select`, `Modal`(внутри Sheet), `Snackbar`,
  `TabsList`, `Placeholder`) — импортируются из кита **напрямую** (осознанно, см.
  `src/ui/README.md`).
- `src/ui/**` не импортирует `@/pages|components|queries|store|providers`
  (низ слоя: только кит, `@/ui/*`, `@/hooks/*`, `@/utils/*`).
- `react-hooks` + `jsx-a11y` recommended для `telegram-app/src/**`.
- type-aware правила пока **не включены** (шумно/медленно на tgui-типах).

## 7. UI-фасад `src/ui/` — главное знание

Полный реестр отклонений — `src/ui/README.md`. Кратко:

- Каскад: tgui подключён как `@import ... layer(tgui)` (`index.css:7-8`).
  Неслойные CSS-модули приложения **всегда** бьют слойный кит — `!important` не нужен,
  специфичность не важна. Пиннится тестом `src/__tests__/layoutCss.test.ts`.
- **Удвоение селектора (`.X.X`) поднимает специфичность** (0,2,0 против
  0,1,0) и матчит элемент с ОДНИМ вхождением класса — проверено в браузере
  (`el.matches('.a.a') === true` при `class="a"`). Это приём, а не ошибка: в
  репозитории 39 таких рабочих правил. Против кита он не нужен (решает
  слой), оправдан только против одноимённого правила потребителя.
  **Не «чинить» `.X.X` → `.X`: я так сделал в 23 местах и откатил — это
  снижало специфичность без причины.**
- **Настоящая находка 2026-10-01:** `ui/Card` не добавлял `styles.card` в
  `className` (только `cardDefault`/`cardFlush`), поэтому `.card.card` не
  матчился ни с чем — карточки рендерились дефолтами кита: radius 20 и
  фон-литерал `tertiary_bg_color` (`rgb(42,42,42)`) вместо темы Telegram.
  Пин: класс в DOM — `src/ui/__tests__/card.test.tsx`; «класс не применяется»
  — `src/__tests__/cssClassReach.test.ts`; каскад в браузере —
  `e2e/ui-cascade.mjs`. Разбор — `src/ui/README.md`, «Правило, которое не
  применяется».
- **Фасад `ui/` — 17 компонентов.** Обёртки кита (вид держит фасад):
  `Page`←`List`, `Button`, `IconButton`, `Chip`, `Card`, `Sheet`←`Modal`,
  `Field`+`FieldError`←`Input`/`Textarea`/`Select`, `EmptyState`←`Placeholder`,
  `Loading`←`Spinner`+`Placeholder`, `FetchMore`←`Button`, `Cell`,
  `Section`. Свои
  (свой markup на токенах): `Notice`, `Stack`, `SectionBody`, `CharCounter`.
  ESLint запрещает прямой импорт кита для `Button`, `IconButton`, `Card`,
  `Cell`, `Section`, `List`.
- **`ui/Cell` (2026-10-01).** Интерактивная строка обязана быть нативной
  кнопкой: `Component="button"` — документированный способ кита (Cell.d.ts)
  и единственный путь с фокусом, Enter/Space и ролью кнопки. Кит UA-стили
  кнопки **не сбрасывает** (замер A/B: Arial 13.33px, чёрный цвет,
  `appearance:auto`, `box-sizing` border-box против content-box, ширина
  356 против 404) — сброс живёт в `ui/buttonReset.module.css` (`AS_BUTTON`),
  одинаков для обоих корней. Пин: `src/ui/__tests__/cell.test.tsx`.
- **`Chip` и `Accordion.Summary` с `Component="button"`** (4 + 2 места) текут
  тем же, поэтому `ui/Chip` несёт `AS_BUTTON`, а `Accordion.Summary`
  получает константу явно.

  применяется».

## 8. Тема и safe-area (самое неочевидное)

- `AppConfig.tsx`:
  - `useTguiPlatform()` — iOS→`ios`, всё остальное→`base`; dev-оверрайд платформы
    (`utils/devPlatform`, `DevToggles`) важнее клиента.
  - `useTelegramAppearance()` — двойная тема: сигнал `miniApp.isDark` + ручной
    оверрайд (светлая/тёмная палитры Telegram inline). `AppRoot appearance` +
    класс `dark` на `<html>` для `--app-*`. `--tg-theme-*` биндятся SDK **инлайном
    один раз** — при оверрайде переставляются вручную.
  - `setHeaderColor(bgHex)` — **hex, не keyword**: keyword на iOS-фуллскрине даёт
    невидимый статус-бар/пилюли; hex выбирает `.Black/.White` по lightness.
  - `useFullscreenSubscription()` — Bot API 8.0, запрос на mount + повтор через
    `setTimeout(50)` (viewport монтируется асинхронно); `ConcurrentCallError` глушится.
- Safe-area (`index.css:21-99`): агрегаторы `--tg-safe-area-*` =
  `max(env(safe-area-*), SDK-переменные, floor)`. `env()` рядом с SDK-переменной в
  `max()`, **не** как fallback `var()` (SDK всегда определяет переменную, даже нулём).
- iOS-баг: в фуллскрине клиент отдаёт `safe_area=0` поверх отрисованного хрома.
  `useTelegramChromiumFallback.ts` ставит токен-floor `--tg-safe-area-top-min` =
  `--tg-telegram-chromium-height` (88px, калибровка iPhone 11 / TG 12.9.4) и «пинает»
  клиент `request('web_app_request_safe_area'|'...content...')`. Менять 88px только
  синхронно в `index.css` и `DEFAULT_THRESHOLD_PX` хука.
- `Tabbar`/`FixedLayout bottom` паддит только `env(safe-area-inset-bottom)` (=0 в TG iOS) —
  компенсируется `max(...)`-токеном.

## 9. Auth и сессия

- Вход: `AuthGate.tsx` → `useAuthStore.bootstrap()` (`store/useAuthStore.ts:172`) →
  `getRawInitData()` (сырая строка, **без пересортировки**, иначе HMAC не сойдётся) →
  `POST /api/v1/auth/telegram { initData }`. Личность проверяет бэкенд HMAC
  (`@telegram-apps/init-data-node`); клиентские данные не принимаются на веру.
- `AuthStatus`: `idle | initializing | authenticated | unauthenticated | error |
  background | banned | deleted`. **`error` никогда не выставляется** (везде
  `unauthenticated`) — недостижимые ветки `AuthGate.tsx:73,179` (см. Findings).
- 403 `FORBIDDEN` → бан (`banReason`, экран + форма апелляции через публичный
  `POST /feedback/appeal` с raw initData). 403 `FORBIDDEN` + message
  `"Account is deleted"` → «Профиль удалён». Проверять удаление **до** бана (код совпадает).
- 429 → cooldown 60с в `AuthGate` (повторные нажатия продлевают rate-limit окно).
- Фон: `visibilitychange` → `handleBackgroundState`; при возврате refresh, если истёк.
- `clearSession`/`markAccountDeleted` пуржат кэш launch params SDK
  (`purgeLaunchParamsCache`: ключи `nlaunchParams` и `tapps/launchParams`) —
  иначе сырая initData переживает logout в sessionStorage.

## 10. API-клиент (`api/client.ts`)

- `apiClient` — синглтон. Все ответы парсятся Zod-схемой из `@edem/contracts`;
  невалид → `ApiError("Invalid server response", "INVALID_RESPONSE", 502)`.
- Таймаут 15s (и в `doFetch`, и в refresh), корректная проброс-отмена внешнего `signal`
  (в т.ч. уже aborted до старта).
- `ApiError`: `code`, `status`, `retryAfterMs`, `banReason` (PII, не логируется).
- **Single-flight refresh** `tryRefresh()`: один запрос на N параллельных 401;
  `refreshGeneration` инвалидирует применение результата после логаута
  (`invalidatePendingRefresh`). 400/401/403 → `permanent-rejection` (403 `FORBIDDEN` →
  `emitBanned`/`emitDeleted` + `emitSessionExpired`); прочее → `transient-failure`
  (сессию не рвём).
- События (подписки в `AuthGate`/`useAuthStore`/`WsProvider`): `tokenUpdate`,
  `sessionExpired`, `banned`, `deleted`, `refreshStart`, `refreshEnd`.
- Ретраи QueryClient (`AppConfig.tsx:29-58`): 4xx (кроме 408) и `INVALID_RESPONSE` — без
  ретрая; сеть/5xx — до 3; `staleTime 60s`; `refetchOnWindowFocus:false`; мутации — 0 ретраев.

## 11. Realtime (ws.v1)

Контракт ws.v1 удалён из дерева — смотри git (бывший
`docs/migration/telegram-realtime-contract.md`); схемы — `@edem/contracts`
(`wsServerEventSchema`/`wsClientMessageSchema`). Транспорт-политика — `src/api/ws.ts`.

- Сокет открывается только при `status==="authenticated"`. JWT — **первым сообщением**
  `{"type":"auth","token"}`, **никогда** в URL/query (утечка в логи).
- Серверный `ping` → клиентский `pong`. Клиентского ping/subscription нет.
- Reconnect: bounded backoff 1s→30s, jitter 0.75..1.25 (`computeReconnectDelay`).
- Close-политики (`classifyWsClose`): `4403` terminal (без refresh-loop),
  `1008/4401` auth-refresh (через `apiClient.tryRefresh`), `1000` stop, остальное —
  reconnect. Внутри 4403 причина (`CloseEvent.reason`) решает, **удалён** аккаунт
  или **забанен** — экран у них разный; строки бэкенда перечислены в §18.
- Пауза reconnect в background/offline, resume по `visibilitychange`/`online`.
- Ресинк после каждого reconnect (`resyncSeq > 0`) — инвалидация
  `TRIP_KEYS.all`/`BOOKING_KEYS.all`/`NOTIFICATION_KEYS.all` (HTTP refetch, не replay).
- Дедуп событий: модульное множество `realtimeSeenEvents` (живёт между маунтами и
  между тестами одного файла — **в тестах ключи уникальны**), cap 200.
- `notification:new` — только hint, тоста нет. Хинт **сужен**: инвалидирует
  `NOTIFICATION_KEYS.unreadCount()` + `NOTIFICATION_KEYS.lists()` (текущий список),
  НЕ blanket `all`. Остальные (`booking:*`, `trip:*`) — инвалидация + Snackbar + haptic.
- **Строка-настройка = `Cell` + переключатель в `after`, без своих рамок.**
  Две ловушки, обе измерены в браузере (2026-10-01):
  1) `width: 100%` + `padding` + `border` при `box-sizing: content-box` дают
     переполнение: у профиля было **382px против 356px** родителя, уход за
     правый край. Дефект маскировали `box-sizing` в одних модулях и
     отсутствие padding — в других.
  2) `Section` вставляет `Divider` только между **прямыми** детьми
     (`Children.map` + `Divider` в Section.js). Обёртка `Stack` прячет строки
     от кита: разделителей не будет, вместо них свой `gap`.
  Строка-переключатель не кликабельна целиком: нативный `Switch` внутри
  `<button>` — невалидная вложенность и двойное срабатывание на Enter/Space.
  Доп. действие внутри секции, если понадобится, — слот `footer`: отдельным
  ребёнком его отделил бы разделитель строк. Конкретно кнопка сброса темы
  «Как в Telegram» удалена по решению продукта (2026-10-02); следствие —
  `themeOverride` живёт в localStorage, переключатель ставит только
  light/dark, поэтому вернуться к «как в Telegram» из UI нельзя. Путь
  обратно, если понадобится: 3-состоянийный цикл (auto → light → dark → auto).
  Пин: `pages/Profile/__tests__/switchRow.test.ts`.
- **Файл `WebSocketProvider.tsx` = 613 строк**: транспорт (WsProvider) + доменные
  подписки (TelegramRealtimeListener) + классификатор 4403. Кандидат на вынос
  listener (см. §17).

## 12. Роутинг и deep links

- `router/AppRouter.tsx`: `HashRouter`; `Shell` держит `NavHeader`, `AppBottomBar`,
  `route-fade` (CSS, не motion/react — экономия ~39 KiB), `useScrollRestore`.
- Нативный `backButton`: сначала state-модалка (`handleModalBack`), затем history,
  fallback в `/bookings` для `/trips/my/new`, иначе `/`.
- `settingsButton` ведёт в `/profile` везде, кроме профиля.
- Стартовый `tgWebAppStartParam` разбирается один раз (`didHandleStartParam`):
  `resolveStartParamRoute` (`router/deepLinks.ts`) — `trip_<uuid>` → `/trips/<uuid>`,
  section-токены из `START_PARAM_ROUTES`, неизвестный → `FALLBACK_ROUTE` (`/trips`).
  В startapp **нельзя** сырые данные пользователя; per-entity id идут через
  `Notification.deepLink`.
- Таб определяется по `location.pathname`; заголовки — `HEADER_TITLE_RULES` на уровне
  модуля (не пересоздаётся).
- `route-fade` key = только `pathname` (смена query не перемонтирует страницу, чтобы не
  терять скролл/скелетоны).

## 13. Query keys и уведомления

### Query keys

`queries/useTripsQuery.ts`: `TRIP_KEYS = { all, lists(), list(filters), my(),
details(), detail(id) }`. Аналогично `BOOKING_KEYS`, `NOTIFICATION_KEYS`.
`NOTIFICATION_KEYS = { all, lists(), inbox(limit, segment), unreadCount() }`.
Цикл избегается сырым `["bookings"]` в `useInvalidateTripsAndBookings`
(`useBookingsQuery` импортирует `TRIP_KEYS`).

### Уведомления — что есть (после плана 2026-10-01)

- **Backend** (`backend/src/notifications/index.ts`): `GET /my` (cursor + `?role=`/`?unreadOnly=`),
  `GET /unread-count` (owner-scope, лёгкий), `PATCH /:id/read` (scoped `updateMany` + 404),
  `PATCH /read-all`. Схемы — `unreadCountSchema`, `notificationsQuerySchema` в контрактах.
- **Retention**: `pruneOldNotifications` в `notification.service.ts` (outbox 30д,
  inbox read 90д / unread 180д), хук в `processExpiredTrips` (tripWorker), knobs в `env.ts`.
- **RecipientRole**: `Notification.recipientRole` (String?, миграция
  `20261001092913`), `?role=` = stored role OR legacy `NOTIFICATION_ROLE_TYPES` fallback.
- **notifyUser** (`notification.service.ts`): `createNotification` + WS-hint
  `notification:new` с `NOTIFICATION_HINT_REFRESH_ID` — только при созданной записи.
- **Dispatcher** (`workers/notificationDispatcher.ts`): recovery зависших `processing`
  (`TG_NOTIFICATION_PROCESSING_TIMEOUT_MS`, дефолт 10 мин), `chat_not_found`/`permanent`
  → терминально, `skipped/no_token` без токена, `trip_details_changed` в критичных.
- **Client**: бейдж на табе — `useUnreadCountQuery()`; хинт сужен до счётчика + текущего
  списка; мутации чтения патчат оба кэша (`applyMarkReadCaches`/`applyMarkAllReadCaches`).

## 14. Тесты — конвенции

- Запуск: `npm run test --workspace=telegram-app` (vitest run). **Нет setup-файла**:
  моки (`vi.mock`, matchMedia, ResizeObserver, `AppRoot`-обёртка для tgui) — в каждом
  файле при необходимости. Для tgui-компонентов используется SSR `renderToString`, а не
  тестирование внутренностей кита.
- `src/__tests__/kitContract.test.tsx` — **падает при смене версии tgui**: при апгрейде
  пройти реестр отклонений `src/ui/README.md` и обновить контракт.
- `src/__tests__/layoutCss.test.ts` — пин каскада (слой tgui бьётся неслойными модулями).
- `AppConfig.test.tsx` — контраст палитр темы.
- Тест `init.mockMacOS.test.ts`, `toSnakeThemeParams.test.ts` — поведение macOS-моков.

## 15. Gotchas SDK 3.0.23 (частые грабли)

- `mockTelegramEnv.onEvent` получает **объект `{ name, params }`**, не кортеж `[method]`
  (в `@telegram-apps` 3.3.x было иначе — легко получить молча неработающий мок).
- `themeParams.state()` и `tgWebAppThemeParams` — snake_case; `toSnakeThemeParams`
  страхует от camelCase-источника.
- `mount()` синхронны (кроме `viewport.mount`); каждый — **ровно один раз**.
  `themeParams` монтировать **первым** (`miniApp` читает тему при монтировании).
- `bindCssVars()` — только после mount своего компонента.
- `ifAvailable` — no-op (не исключение) на неподдерживаемом методе: доступность
  проверять явно через `isAvailable()` (см. `shareViaTelegram`, `openTelegramUrl`).
- Статические `requestSafeAreaInsets/...` удалены в 3.0.x — использовать `request(...)`.
- `retrieveRawInitData()` — сырая строка; не пересобирать и не сортировать.

## 16. Skills (загружать через skill tool)

Проектные скиллы, релевантные `telegram-app/` (`.opencode/skills/`):

| Skill | Когда |
|---|---|
| `telegram-mini-app` | TWA, init data auth, TG WebView, mockEnv, dev через туннель |
| `telegram-ui` | пропсы/гочи tgui, замена кастомного UI, отладка рендера в WebView |
| `ui-ux-pro-max`, `frontend-design` | дизайн новых экранов/компонентов, визуальное направление |
| `vercel-react-best-practices` | рефактор React, bundle, waterfalls, ре-рендеры (70 правил) |
| `typescript-advanced-types` | сложная типизация, generic-компоненты, type-safe API |
| `a11y` | аудит WCAG 2.2 AA перед мержем (фокус, live-regions, контраст, тап-таргеты) |
| `security-audit` | auth/dev-auth, валидация, rate-limit, WS, error-shape |
| `code-review-and-quality` | ревью диффа/PR по 5 осям, размер изменений, дед-код |
| `playwright-e2e` | e2e (`e2e/telegram-*.mjs`), стабильность, reseed-safe |
| `ponytail` | минимализм: stdlib/нативные решения раньше кода; YAGNI |
| `context7` / `find-docs` | актуальные доки библиотек по API/конфигу |
| `prisma-cli`, `prisma-database-setup` | backend-схема/миграции (важно при контрактах) |
| `hono-api-scaffolder` | API-роуты бэкенда (эндпоинты, Zod, error JSON) |
| `task-management` | разбиение фичи на подзадачи, зависимости |

Ключевые правила из них, применимые здесь:
- **Correctness first**: тесты покрывают поведение, не реализацию; edge/error пути.
- **Не оставляй dead code**; не плоди near-duplicate хелперы; не тащи фичевую логику
  в shared-модуль; следи за размером файла (~1000 строк — сигнал к декомпозиции).
- **Auth/валидация на границах** — не лениться (это явное исключение из ponytail).
- **a11y**: icon-only → `aria-label`; async-итоги → `aria-live`; фокус после навигации;
  `prefers-reduced-motion`; тап ≥44px.
- **e2e**: без `waitForTimeout` для UI, уникальные данные на прогон, cleanup в `finally`,
  `pageerror` валит прогон.
## 17. Findings / кандидаты в работу (на 2026-10-02)

Полный аудит `telegram-app` (12 дефектов, план `.tmp/tasks/tg-bugfix-audit/`)
закрыт. Ниже — что осталось после него.

**Авторитетный реестр отклонений и находок — `src/ui/README.md`, раздел
«Реестр отклонений от дефолтов кита» (строки 1–20).** Здесь только то, что
требует продуктового решения, а не правки кода.

| Severity | Файл:строка | Что | Направление |
|---|---|---|---|
| ~~medium~~ | ~~`package.json:15`~~ | ~~скоуп `@tma.js/sdk-react` устарел~~ | **ОПРОВЕРГНУТО 2026-10-01**: стоит `3.0.23` = `npm view @tma.js/sdk-react version` → 3.0.23, т.е. актуальная. Следить только за новыми мажорами; при апгрейде — сверить changelog + `kitContract` |
| medium | `WebSocketProvider.tsx` | транспорт + доменные подписки в одном файле (613 строк) | вынести `TelegramRealtimeListener` в `providers/` |
| medium | `useAuthStore.ts` (`bootstrapPromise`) | нет таймаута на самом bootstrap: unsettled-промис блокирует все будущие `bootstrap()` | страхуется 15s-таймаутом `apiClient`; при смене транспорта понадобится явный |
| low | `AppConfig.tsx` | дубль списка `THEME_VAR_NAMES`/палитр | приемлемо, покрыто тестом контраста |
| ~~low~~ | ~~`backend/ENVIRONMENT.md`~~ | ~~секция уведомлений устарела~~ | **ЗАКРЫТО 2026-10-01**: переписана — реальный статус `skipped` (не `disabled`), нет несуществующего `tg_delivery_failed`, задокументированы все 12 переменных уведомлений с дефолтами |
| low | `backend/src/admin/index.ts:654` | unban **не** переоткрывает WS: клиент после бана держит `terminalTokenRef` и разлогинится до перезапуска приложения | снимать терминал по HTTP-баунсу или документировать «перезапустите апп» |
### Требуют решения владельца (замер 2026-10-02, реестр `src/ui/README.md`)

| Severity | Где | Что | Вопрос к владельцу |
|---|---|---|---|
| **high** | `index.css:200`, реестр #20 | Контраст текста `Notice` ниже WCAG AA в **4 сочетаниях из 6**: danger/светлый 3.55, success/светлый **2.02**, info/светлый 4.02, danger/тёмный 4.06 (порог 4.5 при 12px/400) | Тон приходит из палитры кита (`--app-success: var(--tgui--green)`), а палитра под замком ADR `shared-design-tokens` (Proposed) и `token:check` её не покрывает. Переопределять ли `--app-*` для текста, оставив фон? |
| medium | `NotificationsPage.tsx:347`, `AppRouter.tsx:118`, реестр B3 | Сбой счётчика даёт ложное «Все уведомления прочитаны» + disabled при 9 непрочитанных (`counter.data ?? 0`) | Что показывать при **неизвестном** счётчике? Схема `?? 0` используется в двух местах |
| medium | `ProfilePage`, реестр B5 | 2 `role=tab`, но нет `role=tabpanel` и `aria-controls` (стрелки работают) | Переделка разметки табов под ARIA APG — отдельная задача |
| medium | китовский `Multiselect` 2.1.13, реестр #19 | Объявляет `role=listbox`, но 64 пункта без `role=option`/`aria-selected`/`id` | Чиним обёрткой или оставляем дефект кита? |
| low | `ProfilePage`, реестр B6 | Переключатели настроек — `input[type=checkbox]` в `label`, без `role="switch"` | Не проверено, приходит ли роль из обёртки кита |

~~Проверено и актуально: «Bot API заблокирован продуктовым решением»~~ —
**ОПРОВЕРГНУТО 2026-10-01.** Я тогда сверился с ADR и комментарием
`schema.prisma:128`, а не с гейтом в коде, и ошибся. Факты: канал
**реализован и включён по умолчанию** — `TELEGRAM_DELIVERY_ENABLED` (дефолт
`true`), `telegramSend.ts` делает реальный `fetch` на
`api.telegram.org/bot$TOKEN/sendMessage`, покрыто `backend/tests/e2e/
botApiSend.test.ts` (200 delivered, 403 bot_blocked, 400 chat not found, 429
retry_after, kill-switch). Условия отправки: флаг + токен + согласие.
`README.md:12,346` исправлены. Комментарий `schema.prisma:128` тоже устарел
(«Bot API blocked») — требует правки.

Закрыто аудитом (не возвращать): `?segment=driving` вёл на «Все» вместо
«Водитель» (3 точки входа); автодогрузка списков не работала нигде (observer
не навешивался на поздно появившийся сентинел); close 4403 всегда показывал
бан, и удалённый аккаунт не мог увидеть экран «Профиль удалён»;
`refreshSession` воскрешал `authenticated` при `session === null`;
`SearchPage` игнорировал смену `?from/?to`; отметка прочитанным не была
оптимистичной; время в уведомлениях считалось в зоне устройства вместо
`Europe/Moscow`; счётчик «Прочитать все» подставлял сегментное число как
глобальное; таймер 429 не останавливался на нуле; `closingBehavior` снимался
при уходе любой из грязных форм; статус `"error"` был недостижим.

## 18. Инварианты, добавленные аудитом (не ломать)

| Инвариант | Где |
|---|---|
| 4403 различает удаление и бан по **трём** строкам причины: `Account is deleted` (ws-auth), `Account deleted` (DELETE /me, **без «is»**), `Account is banned`; незнакомая → `banned` + один HTTP-bootstrap с возвратом к дефолту | `WebSocketProvider.tsx` (`classifyTerminalCloseReason`) |
| Подписка сентинела навешивается в момент **появления** узла (эффект на каждом рендере + сверка `observedRef`), а не только на маунте | `useInfiniteSentinel.ts` |
| Результат refresh не применяется, если сессию уже сняли: guard `if (!get().session) return` | `useAuthStore.ts` (`refreshSession`) |
| `markRead` оптимистичен: `onMutate` + снапшот обоих кэшей; `markReadInPages` чистая; декремент счётчика ровно один на вызов | `useNotificationsQuery.ts` |
| Время поездок и уведомлений — только через `moscowDayKey`/`moscowTimeLabel`/`moscowDateLabel` из `utils/date.ts`; `toLocale*` без `timeZone` запрещён | `utils/date.ts` |
| Счётчик «Прочитать все» — только `useUnreadCountQuery`; сегментный `pages[0].unreadCount` как глобальное запрещён | `NotificationsPage.tsx` |
| `closingBehavior` — общее состояние клиента: счётчик грязных форм, а не флаг | `useClosingConfirmation.ts` |
| `ACCOUNT_DELETED_MESSAGE` определена один раз в `api/client.ts`; мок этого модуля обязан повторять её | `api/client.ts` |
| `/users/me` описывает **только** `api/profile.ts`; ключи ресурса — `USER_KEYS` в `queries/profile.ts` | `api/profile.ts`, `queries/profile.ts` |
| Тесты: TZ-зависимое поведение проверяется файлом с принудительным `process.env.TZ`; SSR разделяет соседние текстовые узлы маркером `<!-- -->` | `notificationsTime.tz.test.ts` |
| `role`/`aria-live`, объявленные на узле **портала**, вешаются на пустую обёртку, а не на текст: `Snackbar` уходит в портал `AppRoot`, и роль досталась обёртке. Роль ставится на сам элемент, несущий текст, и проверяется DOM-тестом — зонд по рендеру её не видит | `components/Toast/ToastProvider.tsx`, `Toast/__tests__/ToastProvider.test.tsx` |
| `prefers-reduced-motion` для шторки vaul — удвоенный селектор `[vaul-drawer][vaul-drawer]`: он поднимает специфичность без запрещённого `!important` | `index.css` |
| **Сетевая ошибка справочника — не ошибка валидации:** `cities.isError` обязан давать терминальный `QueryState` с «Повторить», иначе форма висит в загрузке, а submit сообщает «Выберите города из справочника» | `CreateTripPage.tsx` (`cities.isError`) |
| Ошибка поля привязывается `FieldError` с `id` + `aria-describedby`; `Field`/`CityPickerField` принимают `error`. Непривязанная ошибка читается, но не достигает скринридера при фокусе | `CreateTripPage.tsx` (10 полей), `Field`, `CityPickerField` |
| Ошибка мутации настроек профиля не проглатывается — показывается через `Notice` (уведомления, видимость отзыва и т. п.) | `ProfilePage.tsx` |
| `aria-label` строки меню включает видимую подпись, иначе имя теряет половину смысла («История поездок» без «Завершённые и отменённые») | `ProfilePage.tsx` (`MenuRow`) |

## 19. Куда смотреть дальше

- `README.md` (корень) — продукт, деплой, env.
- Бывшие `docs/migration/*` и отчёты деплоя удалены из дерева — смотри git.
- `docs/deployment/telegram-staging-checklist.md` — живой прод-чеклист.
- `docs/adr/telegram-notification-delivery.md` — доставка уведомлений (inbox + WS + Bot API).
- `e2e/telegram-parity.mjs`, `e2e/telegram-realtime.mjs` — сценарии.
- `packages/contracts/src/index.ts` — Zod-схемы/DTO, общие с backend.
- `webapp/` — админка (shadcn-style), отдельный слой; не путать с mini-app.
- `.tmp/sessions/2026-10-01-notifications-fix/context.md` — контекст плана уведомлений.
- `.tmp/sessions/2026-10-01-tg-bugfix-audit/context.md` — контекст аудита (B1–B12).
