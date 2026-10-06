# telegram-app — MEMORY

> Onboarding-память для следующего агента. Цель: прочитать этот файл и сразу
> понимать устройство, инварианты, конвенции и подводные камни `telegram-app/`,
> не переоткрывая кодовую базу.
>
> Дополняет, не заменяет: корневой `README.md`, `src/ui/README.md`.
> Источник истины по пропсам кита — установленный
> `node_modules/@telegram-apps/telegram-ui/dist/**/*.d.ts` (не docs, не train-дата).

**Состояние:** тесты **909** (112 файлов), e2e-parity **17/17**, контраст под
числовым стражем `e2e/ui-contrast.mjs`. Реестр отклонений по киту —
`src/ui/README.md`: **прочитай его до правок UI/форм**.

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
| Telegram SDK | `@tma.js/sdk-react` | **3.0.23 (пин)** | скоуп `@tma.js/*` — исторический (переименован в `@telegram-apps/sdk-react`); код и тесты единообразно сидят на `@tma.js@3.0.23`, переезд — отдельная работа, а не дефект (см. §17) |
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
  `Button`, `IconButton`, `Card`, `List`, `Cell`, `Section`, `SegmentedControl`
  (у всех есть обёртки; `Page` заменяет `List`, `Switcher` заменяет
  `SegmentedControl`). `Cell` — вместе с фасадом `ui/Cell`, `Section` —
  вместе с `ui/Section`, `SegmentedControl` — вместе с `ui/Switcher`. Компоновочные
  примитивы (`Divider`, `Text`, `Caption`, `Title`, `Headline`, `Avatar`, `Skeleton`,
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
- **Тот же класс дефекта:** `Field` не добавлял свой
  класс обёртке, если потребитель ничего не просил, — и общее правило тона
  подписи поля оказалось бы мёртвым. То же и с китом: `className` у
  `Select` попадает на внутренний `<label>`, а окраска работает лишь
  потому, что китовой `select` = `background: inherit`. **Фасадный
  компонент обязан всегда нести свой класс** — пин в
  `src/__tests__/cssClassReach.test.ts`.
- **Находка:** `ui/Card` не добавлял `styles.card` в
  `className` (только `cardDefault`/`cardFlush`), поэтому `.card.card` не
  матчился ни с чем — карточки рендерились дефолтами кита: radius 20 и
  фон-литерал `tertiary_bg_color` (`rgb(42,42,42)`) вместо темы Telegram.
  Пин: класс в DOM — `src/ui/__tests__/card.test.tsx`; «класс не применяется»
  — `src/__tests__/cssClassReach.test.ts`; каскад в браузере —
  `e2e/ui-cascade.mjs`. Разбор — `src/ui/README.md`, «Правило, которое не
  применяется».
- **Фасад `ui/` — 18 компонентов.** Обёртки кита (вид держит фасад):
  `Page`←`List`, `Button`, `IconButton`, `Chip`, `Card`, `Sheet`←`Modal`,
  `Field`+`FieldError`←`Input`/`Textarea`/`Select`, `EmptyState`←`Placeholder`,
  `Loading`←`Spinner`+`Placeholder`, `FetchMore`←`Button`, `Cell`,
  `Section`, `Switcher`←`SegmentedControl`/`Chip` (переключатель
  «одно из N», семантика `radiogroup`/`tabs` внутри фасада). Свои
  (свой markup на токенах): `Notice`, `Stack`, `SectionBody`, `CharCounter`.
  ESLint запрещает прямой импорт кита для `Button`, `IconButton`, `Card`,
  `Cell`, `Section`, `List`, `SegmentedControl`.
- **`ui/Cell`.** Интерактивная строка обязана быть нативной
  кнопкой: `Component="button"` — документированный способ кита (Cell.d.ts)
  и единственный путь с фокусом, Enter/Space и ролью кнопки. Кит UA-стили
  кнопки **не сбрасывает** (Arial 13.33px, чёрный цвет,
  `appearance:auto`, `box-sizing` border-box против content-box, ширина
  356 против 404) — сброс живёт в `ui/buttonReset.module.css` (`AS_BUTTON`),
  одинаков для обоих корней. Пин: `src/ui/__tests__/cell.test.tsx`.
- **`Chip` и `Accordion.Summary` с `Component="button"`** (4 + 2 места) текут
  тем же, поэтому `ui/Chip` несёт `AS_BUTTON`, а `Accordion.Summary`
  получает константу явно.

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
- **Переход в бан — только через `markBanned()`** (`e46039c`). Прямой
  `setState({status:"banned"…})` больше не встречается нигде: такой путь
  забывал `initData`, а апелляция идёт **без токена** и подтверждается этой
  строкой — форма падала, не отправив запрос. `purgeLaunchParamsCache` при
  бане не зовётся (бан не логаут). Плюс фолбэк `getRawInitData()` в
  `submitSupportFeedback` — на случай ветки «403 на /feedback, статус сессии
  ещё `authenticated`» (`SupportPage`), которая в стор не заходит.
- 403 `FORBIDDEN` → бан (`banReason`, экран + форма апелляции через публичный
   `POST /feedback/appeal` с raw initData). 403 `ACCOUNT_DELETED` → «Профиль
   удалён». Проверять удаление **до** бана. Различение — **по коду**, не по
   тексту: отдельный код `ACCOUNT_DELETED` и предикат `isAccountDeletedError`
   живут в **контрактах** (`@edem/contracts`, `schemas/api-error.schema.ts`) —
   их берёт и бэк, и клиент, поэтому разъехаться они не могут. Фолбэк на текст
   `Account is deleted` — для старого бэка, у которого кода ещё нет.
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
  Две ловушки:
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
   ребёнком его отделил бы разделитель строк. Кнопки сброса темы
   «Как в Telegram» нет: `themeOverride` живёт в localStorage,
   переключатель ставит только light/dark, поэтому вернуться к
   «как в Telegram» из UI нельзя. Путь
   обратно, если понадобится: 3-состоянийный цикл (auto → light → dark → auto).
   Пин: `pages/Profile/__tests__/switchRow.test.ts`.
- **Транспорт разделён: `WebSocketProvider.tsx` = 502 строки + `TelegramRealtimeListener.tsx` = 213 строк.**
  Доменные подписки уже вынесены в `providers/TelegramRealtimeListener.tsx`;
  в провайдере остались транспорт (WsProvider) + классификатор 4403 (см. §17).

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
- **Кнопка настроек — там, где нет кнопки «назад» и есть таббар, то есть на
   корневых маршрутах** (`useSettingsButton(openProfile, isRoot && pathname !== "/profile")`).
   `/profile` исключён отдельно: тап привёл бы на тот же экран. Не-корневые
   маршруты — либо поддерево профиля (переход вёл бы на родителя), либо
   сфокусированный сценарий с возвратом. Нативную кнопку Telegram
   не измерить вне клиента — это unverifiable.
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
- **909 тестов** (112 файлов). SSR-файлы (`renderToString`) не
  видят эффектов, поэтому всё, что живёт в эффекте, проверяется **DOM-файлом
  с `@vitest-environment jsdom`**: `useScrollRestore.dom`, `useTripActions.tick`,
  `SearchPage.reset`, `tripStandardCard.a11y`, `tripCountersSection`,
  `fieldLabelTone` (тон подписи — контракт, а не рендер).
- **`vi.mock` требует `vi.hoisted`.** Фабрика мока поднимается выше
  объявления переменной, и без `vi.hoisted` — `ReferenceError: Cannot access
  'mockX' before initialization`.
- **Авто-cleanup RTL ВЫКЛЮЧЕН**: `globals: true` не задан, поэтому
  `afterEach(cleanup)` нужно ставить **вручную** в каждом DOM-файле. Без него
  размонтированное дерево живёт до конца файла: события достаются старым
   обработчикам, а модульные хранилища (кэш скролла) портятся следующими
   тестами.
- **Нет матчеров jest-dom** (`toBeEnabled`/`toBeDisabled` не существуют) —
  проверять `element.disabled` напрямую.
- **Контраст считается в браузере, не в Node.** `color-mix` в Node не
  вычисляется, а значения токенов принадлежат киту и копировать их в тест
  нельзя («свойство токена должно быть одно»). Поэтому в vitest живёт
  **структурный** пин (тон объявлен в обеих темах, смешивается к нужному
  токену, процент не ниже измеренного минимума), а **числовая граница — в
  `e2e/ui-contrast.mjs`** (`node e2e/ui-contrast.mjs`, тот же приём, что
  `ui-cascade.mjs`: vitest читает текст CSS, нужен результат). Покрыты
  `--app-field-label` (обе темы), тона `Notice`, `--app-muted`.
- **Три грабли контрастного e2e:**
  1) **Подложка — композиция, а не первый непрозрачный предок.** Наложить
     слои на непрозрачного предка, иначе ложное падение.
  2) **Сравнивать цвета числами, не строками.** Движок отдаёт один цвет
     то как `rgb(...)`, то как `color(srgb ...)`; сравнение строк даёт
     0 носителей.
  3) **Селектор с 0 носителей обязан ПАСТЬ** (`requireMin`), иначе шаг
     проходит вхолостую. Порог выводится из размера и веса
     (4.5 / 3:1 крупный), а не берётся из списка.
- **Проверка, которая проходит, ничего не проверяя, — провал, а не успех.**
  Если проверка ничего не нашла (`afterEach(cleanup)` пропущен,
  `requireMin` отсутствует, селектор совпал с нулём элементов) —
  это дефект теста.
- **Перед фиксом проверять, что новый тест падает на старом коде.** Иначе
  тест ничего не пиннит.
- **Протечка cleanup проверяется ВСЕМИ файлами, а не только новыми:**
  размонтированное дерево живёт до конца файла (порталы держат ловушки
  на `document`, таймеры живы) — соседние тесты проверяют чужое дерево.

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
## 17. Findings / кандидаты в работу

**Авторитетный реестр отклонений и находок — `src/ui/README.md`, раздел
«Реестр отклонений от дефолтов кита».** Здесь только открытые пункты,
требующие продуктового решения или будущей работы (закрытые удалены
из таблицы — их состояние живёт в коде и тестах).

| Severity | Файл:строка | Что | Направление |
|---|---|---|---|
| medium | `useAuthStore.ts` (`bootstrapPromise`) | нет таймаута на самом bootstrap: unsettled-промис блокирует все будущие `bootstrap()` | страхуется 15s-таймаутом `apiClient`; при смене транспорта понадобится явный |
| low | `AppConfig.tsx` | дубль списка `THEME_VAR_NAMES`/палитр | приемлемо, покрыто тестом контраста |
| low | `backend/src/admin/index.ts:654` | unban **не** переоткрывает WS: клиент после бана держит `terminalTokenRef` и разлогинится до перезапуска приложения | снимать терминал по HTTP-баунсу или документировать «перезапустите апп» |

Канал уведомлений Bot API **реализован и включён по умолчанию**
(`TELEGRAM_DELIVERY_ENABLED`, дефолт `true`): флаг + токен + согласие.
Покрыт `backend/tests/e2e/botApiSend.test.ts`.

### 17.1 Осознанно оставленное (код не менялся, зафиксировано намерение)

- **Корневой `onClick` карточки — оставлен сознательно** (реестр #24).
  `Card` рендерит `<article>`, имеет только проп `type` и **не имеет**
  `Component` (в отличие от `TappableProps`/`ButtonProps`), поэтому
  кликабельный Card китом не предусмотрен, а `onClick` проходит типизацию
  через `extends HTMLAttributes`. Для AT/клавиатуры операция доступна через
  вложенную нативную кнопку — progressive enhancement, WCAG не нарушен.
- **`<div>` внутри `<button>` — не дефект.** Следствие документированного
  паттерна кита: `TappableProps.children` = `ReactNode`, и
  `Component="button"` с богатыми детьми даёт `button > div`. Реестр #12.
- **`settingsButton` — только на корневых маршрутах** (см. §12).

e2e-parity 17/17. `ADMIN_TOKEN` стенда задан явно в `ecosystem.config.cjs`
(`backend/src/env.ts` зовёт `dotenv.config()` без `override`, поэтому
переменные оболочки побеждают `backend/.env`; `override: true` не вариант —
отдал бы приоритет gitignored `.env` над прод-окружением).

## 18. Инварианты, добавленные аудитом (не ломать)

| Инвариант | Где |
|---|---|
| Удаление аккаунта различается с баном **по коду** `ACCOUNT_DELETED`, а не по тексту. Код, текст-фолбэк и предикат живут в контрактах (`schemas/api-error.schema.ts`), бэк импортирует оттуда же — сверить нечего, расхождение невозможно по построению. Прикладной код берёт ре-экспорт из `@/api/client` | `useAuthStore.ts`, `ProfilePage.tsx`, `bookingErrors.ts`, `VehicleModal.tsx`, `client.ts` (ре-экспорт) |
| В ветке `performRefresh` удаление проверяется **вне** «`code === FORBIDDEN`»: с новым кодом внешняя проверка проглотила бы `emitDeleted`, и удалённый уехал бы на экран логина | `client.ts` (`performRefresh`) |
| 4403 различает удаление и бан по **трём** строкам причины: `Account is deleted` (ws-auth), `Account deleted` (DELETE /me, **без «is»**), `Account is banned`; незнакомая → `banned` + один HTTP-bootstrap с возвратом к дефолту. У close-кадра нет поля `code`, поэтому причина — строка, но и она лежит в `WS_TERMINAL_REASON` в контрактах и импортируется бэком (ws/index.ts, users/index.ts, admin/index.ts) | `WebSocketProvider.tsx` (`classifyTerminalCloseReason`), контракты (`WS_TERMINAL_REASON`) |
| Подписка сентинела навешивается в момент **появления** узла (эффект на каждом рендере + сверка `observedRef`), а не только на маунте | `useInfiniteSentinel.ts` |
| Результат refresh не применяется, если сессию уже сняли: guard `if (!get().session) return` | `useAuthStore.ts` (`refreshSession`) |
| `markRead` оптимистичен: `onMutate` + снапшот обоих кэшей; `markReadInPages` чистая; декремент счётчика ровно один на вызов | `useNotificationsQuery.ts` |
| Время поездок и уведомлений — только через `moscowDayKey`/`moscowTimeLabel`/`moscowDateLabel` из `utils/date.ts`; `toLocale*` без `timeZone` запрещён | `utils/date.ts` |
| Счётчик «Прочитать все» — только `useUnreadCountQuery`; сегментный `pages[0].unreadCount` как глобальное запрещён | `NotificationsPage.tsx` |
| `closingBehavior` — общее состояние клиента: счётчик грязных форм, а не флаг | `useClosingConfirmation.ts` |
| `apiErrorSchema` в контрактах — **спецификация формы без потребителя**: клиент разбирает тело руками в `toErrorRecord` намеренно (не-JSON/HTML от прокси не должны ронять разбор и терять HTTP-статус). Не подменять на `apiErrorSchema.parse` без замера на кривых телах. Не предлагать там же предикат удаления: webapp — только админка (`/api/v1/admin/*`, сессия по `ADMIN_TOKEN`), состояния удалённого пользователя в ней не бывает | `packages/contracts/src/schemas/api-error.schema.ts`, `api/client.ts` |
| `ACCOUNT_DELETED_MESSAGE`/`ACCOUNT_DELETED_CODE`/`WS_TERMINAL_REASON` определены один раз в контрактах; мок `@/api/client` обязан повторять их — без этого ветки «удалён» и классификатор 4403 становятся мёртвыми | `packages/contracts/src/schemas/api-error.schema.ts` |
| `/users/me` описывает **только** `api/profile.ts`; ключи ресурса — `USER_KEYS` в `queries/profile.ts` | `api/profile.ts`, `queries/profile.ts` |
| Тесты: TZ-зависимое поведение проверяется файлом с принудительным `process.env.TZ`; SSR разделяет соседние текстовые узлы маркером `<!-- -->` | `notificationsTime.tz.test.ts` |
| `role`/`aria-live`, объявленные на узле **портала**, вешаются на пустую обёртку, а не на текст: `Snackbar` уходит в портал `AppRoot`, и роль досталась обёртке. Роль ставится на сам элемент, несущий текст, и проверяется DOM-тестом — зонд по рендеру её не видит | `components/Toast/ToastProvider.tsx`, `Toast/__tests__/ToastProvider.test.tsx` |
| `prefers-reduced-motion` для шторки vaul — удвоенный селектор `[vaul-drawer][vaul-drawer]`: он поднимает специфичность без запрещённого `!important` | `index.css` |
| **Сетевая ошибка справочника — не ошибка валидации:** `cities.isError` обязан давать терминальный `QueryState` с «Повторить», иначе форма висит в загрузке, а submit сообщает «Выберите города из справочника» | `CreateTripPage.tsx` (`cities.isError`) |
| Ошибка поля привязывается `FieldError` с `id` + `aria-describedby`; `Field`/`CityPickerField` принимают `error`. Непривязанная ошибка читается, но не достигает скринридера при фокусе | `CreateTripPage.tsx` (10 полей), `Field`, `CityPickerField` |
| Ошибка мутации настроек профиля не проглатывается — показывается через `Notice` (уведомления, видимость отзыва и т. п.) | `ProfilePage.tsx` |
| `aria-label` строки меню включает видимую подпись, иначе имя теряет половину смысла («История поездок» без «Завершённые и отменённые») | `ProfilePage.tsx` (`MenuRow`) |
| **Неизвестное число ≠ ноль.** Формулировка «все прочитаны» допустима только когда число известно и равно нулю; при `data === undefined` имя остаётся нейтральным («Прочитать все»), а действие остаётся рабочим — гасить нечем. Ложное утверждение о состоянии в `aria-label` хуже отсутствия числа | `NotificationsPage.tsx` |
| **Мутация прочтения обязана инвалидировать `lists()` в `onSuccess`, а не только в `onError`.** Патч из ответа одной записи не обновляет ленту целиком. Счётчик не рефетчим — он только что вычислен точно | `useNotificationsQuery.ts` (`useMarkNotificationReadMutation`, `useMarkAllNotificationsReadMutation`) |
| **Настройка вкл/выкл — `role="switch"`, а не чекбокс.** Китовский `Switch` рендерит `input[type=checkbox]` и роль из обёртки не добавляет, поэтому `role="switch"` ставится явно. `aria-checked` руками не задаём: браузер выводит его из `checked`, а дублирование рискует разойтись с реальным состоянием | `ProfilePage.tsx` (`SwitchRow`) |
| **Табы профиля: панель обязана быть в DOM.** `aria-controls` вешаем только на выбранный таб: панели рендерятся условно, и у невыбранного таба `getElementById` даёт null. Отрисовывать обе с панели с `hidden` не стали — это грузило бы отзывы при открытых настройках | `ProfilePage.tsx` (`SUBTAB_IDS`, `SUBTAB_PANEL_IDS`, `onSubtabKeyDown`) |
| **Выбор города — один компонент и всегда по id.** `CitySelectField` (нативный `<select>`) — единственный способ выбрать город: главная, поиск, создание поездки, заявка на посадку. Наружу отдаётся **id** справочника, имя берётся из того же справочника. Причина: подстрочный поиск по имени неоднозначен, а китовский `Multiselect` давал пункты без ролей. Свободный ввод города руками невозможен — это осознанно | `components/CitySelect/CitySelectField.tsx`, `helpers/searchFilters.ts` |
| **Прогон e2e восстанавливает стенд сидом** (`restoreDevStand` в финальном блоке `telegram-parity`). Шаг `delete: удаление профиля` идёт под `u-dev`, а `DELETE /me` по контракту чистит уведомления пользователя — после прогона у дев-юзера оставалось 0 уведомлений вместо 9, и следующий прогон начинал с неполных данных. `reviveDevUser()` чинит только строку пользователя, сид восстанавливает всё. Сид полностью пересобирает БД, поэтому вызывается **после** уборки прогона | `e2e/telegram-fixtures.mjs` (`restoreDevStand`) |
| **Имя экрана задаёт страница, не секция.** `NavHeader` помечен `aria-hidden`, поэтому у каждого маршрута обязан быть свой `h1` (обычно `VisuallyHidden Component="h1"`). `headingLevel="h1"` у `Section` — opt-in для «экрана, где секция владеет именем», и на главной он достался секции «Популярные направления»: скринридер объявлял имя секции как имя экрана | `pages/HomePage/HomePage.tsx`, `components/Section/PopularRoutesSection.tsx` |
| Контраст тона/приглушённого текста считается против **своего худшего фона**, а не против фона секции: это тонированная плашка `--app-*-bg` и серая `#eaeaeb`/`#24303c`. Для тёмного текста худший фон — не белый, а самый тёмный из светлых; для светлого — не `#17212b`, а самый светлый из тёмных. Проверка по фону секции даёт ложное «проходит» | `index.css`, реестр #20 |
| Тон текста задаётся `color-mix` **с чёрным в светлой теме и с белым в тёмной** (коэффициент — минимальный целый процент для 4.5+); фон `--app-*-bg` остаётся китовым. Тёмные тона переопределяются селектором **`.dark .app-theme`**, а не `.dark`: класс темы на `<html>`, а `.app-theme` — на вложенном корне, и собственное объявление бьёт унаследованное | `index.css` |
| **Видимая подпись поля — своя, общий тон.** Подпись рисует сам `Field` (видимый `label`), а не kit-`header`: у kit-`header` нет доступного имени, он только на `base` и лежит поверх рамки. Тон — общий `--app-field-label`, правило — в `ui/` (класс `.fieldLabel`), а **не** в модуле потребителя. `Field` **всегда** добавляет свой класс обёртке — иначе правило мертво | `ui/ui.module.css`, `ui/Field.tsx`, `index.css`, пин `ui/__tests__/fieldLabelTone.test.tsx` |
| **Подложка контрола — серая, подпись и плейсхолдер — в тон.** Все редактируемые поля (`Field`) — на `--tgui--secondary_bg_color`, иначе их не видно на белой секции. Видимая подпись (`h6`) — на прозрачном фоне, без пилюли. Плейсхолдеры — в `--app-muted` (китовый hint ниже AA на сером). Индикация ошибки — `box-shadow`-кольцо кита, серый её не гасит | `ui/ui.module.css`, `ui/Field.tsx`, пин `ui/__tests__/fieldLabelTone.test.tsx`, число — `e2e/ui-contrast.mjs` |
| **`className` китового `Select` попадает на внутренний `<label>`, не на `<select>`.** `Select` отдаёт в `FormInput` только `header`/`before`/`status`/`className`, остальное — нативному `select`. Окрасить фон controls можно только потому, что китовой `select` = `background: inherit`. Обращение с пропами (`id`, `value`, `onChange`, `disabled`, `aria-*`) при этом корректно ложится на сам `select` | `node_modules/@telegram-apps/telegram-ui/dist/components/Form/{Select,FormInput}/*.js` |
| **Позиция скролла меряется непрерывно, а не в момент перехода.** Эффект перехода в `useScrollRestore` запускается уже после подмены DOM, а route-модалки прячут фон в `hidden` → документ схлопывается и `window.scrollY` обнуляется ДО чтения. Сохраняется 0, Back возвращает список наверх | `hooks/useScrollRestore.ts`, пин `__tests__/useScrollRestore.dom.test.tsx` |
| **`hasAuthedRef` сбрасывается только при реальной потере сессии** (`session === null`). Иначе уход в фон (`status="background"`, сокет рвётся, сессия жива) неотличим от логаута, и возвращение из фона — самый частый переход жизненного цикла TMA — не поднимает `resyncSeq`, то есть пропущенное за разрыв не восстанавливается (`refetchOnWindowFocus` выключен) | `WebSocketProvider.tsx`, пин в `__tests__/WebSocketProvider.test.tsx` |
| **Бан — не логаут: `initData` нужен для апелляции.** `purgeLaunchParamsCache()` зовётся в `clearSession`/`markAccountDeleted`, но **не** при бане. Путь входа один (`markBanned`), иначе ветка WS 4403 или `onBanned` забудут заполнить строку и форма обжалования упадёт | `useAuthStore.ts`, `AuthGate.tsx`, `WebSocketProvider.tsx` |
| **Словари ошибок и маршрутов ищутся только по СОБСТВЕННЫМ ключам.** `error.code` приходит из тела ответа бэкенда; прямой индекс объекта отдаёт унаследованный член `Object.prototype` (`toString`, `constructor`), а он `!== undefined`. Индекс-сигнатура объявляет значение как `string`, поэтому **типы это не ловят** — нужен `Object.hasOwn` + проверка типа | `helpers/bookingErrors.ts`, контраст `router/deepLinks.ts` |
| **«Завтра»/«Выходные» — календарные дни, не «сейчас + 24 часа».** `local midnight + 86 400 000 мс` в зоне с переводом часов даёт 23:00 того же дня. Москва фиксирована по смещению, поэтому дефект не виден на московских тестах — TZ-файл форсирует `Europe/Berlin` | `helpers/searchFilters.ts` |
| **TZ-зависимое поведение проверяется файлом с принудительным `process.env.TZ`.** Дефекты перевода часов и «зона устройства вместо Москвы» **не воспроизводятся** на машине в UTC или в Europe/Moscow — такие тесты проходят и не проверяют ничего | `searchFilters.tz.test.ts` (`Europe/Berlin`), `moscowNumericDate.tz.test.ts` (`America/Los_Angeles`) |
| **Читать данные инфинити-запроса только полной опциональной цепочкой** (`pages[0]?.pagination?.total`). Пока идёт загрузка, `data` может быть неполным, а вычисление ДО раннего возврата упадёт на `pagination` | `TripCountersSection.tsx` |
| **`useTripActions`: время «сейчас» двигается один раз, на границе отправления.** Снимок `Date.now()` на маунте замораживал `canCompleteTrip` (чисто клиентский гейт). Интервал не подходит — открытая страница будет ререндерить впустую; таймер ограничен int32, иначе «через месяц» переполняется и стреляет сразу | `pages/TripDetails/useTripActions.ts`, пин `__tests__/useTripActions.tick.test.tsx` |
| **Догрузка страниц только когда сервер сказал, что данных не хватает** (`total > загружено`) **и** с остановкой по `isFetchNextPageError`. Без гарда на ошибку — бесконечный цикл запросов, потому что `hasNextPage` остаётся `true` | `TripCountersSection.tsx` |
| **Пилюля сегмента даты применяет фильтр сразу, без «Найти»:** `set("dateSegment", …)` менял только `form`, а запрос едет от `submitted` — пилюля отзывалась визуально, а список оставался прежним («фильтр не работает»). Применяется весь набор формы, а не только дата. Остальные контролы (города, цена, теги) остаются на «Найти» — там нужен явный ввод. Следствие: состояние «форма нейтральна, запрос отфильтрован» через пилюлю даты недостижимо, тупик с погасшим сбросом воспроизводится только городами/ценой/тегами | `pages/Search/SearchPage.tsx`, пин `__tests__/SearchPage.dateSegment.test.tsx` |
| **День поездки для группировки берём из `departureAt` через `moscowDayKey`, а НЕ из `trip.date`:** бэк отдаёт `trip.date` отформатированной подписью («сб, 15 марта» — `formatDateRu`, ru-RU + Europe/Moscow), а не ISO — `dayLabel()` на такой строке не срабатывает и подписи «Сегодня»/«Завтра» не появляются. Порядок задаёт бэк (`orderBy: [{departureAt:"asc"},{id:"asc"}]`), поэтому группы копим в **соседнюю**, а не через `Map` по ключу: `Map` схлопнул бы день, разорванный другим, и переставил карточки. Пилюля — статичный центрированный `h2` без счётчика (группа, разрезанная страницами, посчиталась бы частично) | `helpers/tripGroups.ts`, `pages/Search/TripDateDivider.tsx` |

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
- `.tmp/sessions/2026-10-05-tg-bugfix-audit-2/context.md` + `.tmp/tasks/tg-bugfix-audit-2/
  — контекст и подзадачи аудита (все закрыты). Перед новой правкой
  **прочитай реестр `src/ui/README.md`** — там записаны действующие
  отклонения от кита.
