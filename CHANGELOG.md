# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
проект придерживается [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Fixed

#### Telegram Cascade Layers (tgui в слое tgui)

- **Диагноз**: конфликт был системный, а не точечный. В Tailwind v4 весь фреймворк (`@import "tailwindcss"`) живёт в каскадных слоях (`@layer theme, base, components, utilities`), а стили tgui импортировались напрямую в `main.tsx` — без слоя. По CSS Cascade 5 неслойные стили побеждают слойные всегда, независимо от порядка импортов и специфичности. Поэтому комментарий «стили tgui ПЕРВЫМИ — чтобы наши переопределения имели приоритет» не работал: Tailwind-утилиты проигрывали tgui в любом конфликте. Симптом: ~30 `!`-хвостов в 7 файлах (AppBottomBar, AppHeader, CityPickerField, HomePage, ProfilePage, SearchPage, CreateTripPage).
- **`telegram-app/src/index.css`**: объявлен порядок `@layer theme, base, tgui, components, utilities`, tgui импортируется с `layer(tgui)` между base и components — preflight (base) нативные стили tgui не трогает, а utilities/components и неслойные классы приложения переопределяют tgui без `!important`.
- **`telegram-app/src/main.tsx`**: прямой импорт tgui-стилей убран (был единственным местом импорта).
- Существенные `!`-модификаторы сознательно не тронуты: после фикса они избыточны, но безвредны (страховка от собственных неслойных правил). Возможный ожидаемый эффект: ранее молча проигрывавшие tgui утилиты теперь применяются — ключевые экраны (таббар, хедер, модалки) проверить визуально в dev-режиме.

### Changed

#### Фильтр цены в поиске — слайдер вместо ручного ввода

- `SearchPage`: «Цена не выше» — нативный tgui `Slider` (100–3000 ₽, шаг 100) вместо `<Input type="number">`: удобнее на мобильном, значение физически не выходит за диапазон — класс ошибок валидации ввода исчезает. Крайнее правое положение = «Любая цена» (фильтр снят), текущее значение показывается подписью рядом с заголовком.
- `searchFilters`: `maxPrice: string` → `number | null` (`null` — без лимита), константы `PRICE_SLIDER_MIN/MAX/STEP`, форматтер подписи `formatMaxPriceLabel`. API (`SearchTripsFilters.maxPrice`) и бэкенд без изменений.
- A11y: слайдер связан подписью через `aria-labelledby`, значение озвучивается через `getAriaValueText` («до …» / «Любая цена»).

#### Экспресс-поиск главной — нативный стандарт tgui

- Блок «Куда поедем?» переведён на стандарт `Section` + `Input header`: инпуты — прямые дети секции (нативные дивайдеры), внешние `FormField`-обёртки и absolute-оверлей swap-кнопки убраны (заодно минус один `!`-хвост), swap — в `after`-слоте «Откуда», сегмент дня и сабмит — после секции. Нюанс: tgui рендерит `header` только на base — на iOS подписей не будет видно, для скринридеров оставлены `sr-only` label.

#### Популярные направления — нативный список

- Мини-плитки направлений заменены списком: `Cell`-кнопки (`Component="button"`, иконка + маршрут, `aria-label`) — прямые дети `Section`, дивайдеры нативные. Промежуточный вариант на `Card` отклонён: карточкам без фото его поверхность ни к чему.

#### Ближайшая поездка — нативный Cell

- Карточка ближайшей брони пересобрана на стандартных слотах `Cell`: маршрут — header, водитель — `subtitle`, дата/время — `description`, справа в `after` — цена + статус-пилюля. Кастомные строки и шеврон убраны (тапабельность даёт `Tappable`-обёртка с `aria-label` маршрута).

#### Профиль-бар главной ведёт в профиль

- Тап по профиль-бару на главной (`Cell` с аватаром/именем/рейтингом) открывает вкладку профиля (`/profile`, таб подсвечивается роутером): обёртка `Tappable` + `haptic.light`, `aria-label="Открыть профиль"`, визуал без изменений. Работает и при ошибке профиля (состояния отрабатывает сама страница профиля).

#### Экспресс-поиск главной — пикеры городов из справочника

- Поля «Откуда/Куда» на главной были plain-Input без автодополнения (напечатанное начало города никуда не вело) — заменены на `CityPickerField` (Multiselect по справочнику БД, как на создании поездки). Частичное имя по-прежнему ищется и без выбора (contains-поиск бэкенда). Swap на экспресс-форме убран (оверлей несовместим с Multiselect; на создании поездки остался).
- Сегменты дня («Сегодня/Завтра/Выходные») с главной убраны — пресет на `/trips` всегда без дат (все даты, выбор — на странице поиска). Кнопка «Найти поездку» переехала в `footer` секции (в `children` Section ставила бы лишний дивайдер) и стала овальной (`rounded-full` поверх tgui за счёт слоя, без `!important`).

#### Города создания поездки — нативный Multiselect (max 1)

- `CityPickerField` переписан на tgui `Multiselect` (минус ~90 строк кастомного дропдауна с `!`-хвостами): опции из справочника БД (`value` = id, `label` = имя), дефолтный фильтр, выбор чипом со снятием крестиком/Backspace, `closeDropdownAfterSelect`, `emptyText` сохранён.
- max = 1 (у `Multiselect` нет max-пропа): кламп последнего в `onChange`, повторный выбор заменяет текущий; чистые хелперы `toCityOptions/selectedCityOptions/cityNameFromPicked` покрыты unit-тестами + SSR (связь label/id, чип).
- `creatable={false}` осознанно: валидатор `createTripForm` и бэкенд требуют город из справочника (`fromCityId/toCityId`), свободного ввода нет — контракт с родителем (имя-строка) без изменений.
- A11y/e2e: видимый `<label>` + `id` на внутреннем инпуте сохранены (`getByLabel` жив), клик опции — по точному тексту (у ячеек дропдауна tgui нет `role=option`); селекторы 4 e2e-файлов обновлены (прогон не выполнялся).

### Added

#### Telegram App — Фаза 1 (фундамент telegram-app)

Новый workspace `telegram-app/` (React 19 + Vite 8 + `@telegram-apps/sdk-react@3.3.9` + `@telegram-apps/telegram-ui@2.1.13`). `telegram-ui` декларирует peer `react ^18`, но React 19 проверен рантайм-рендером (SSR-тест: AppRoot/List/Cell/Button рендерятся, `defaultProps` в dist отсутствуют); bun peer-зависимости не форсит — установка чистая. TON Connect не ставится (крипта не применима к райдшерингу).

- **SDK init** (`src/init.ts`, `src/mockEnv.ts` — паттерны reactjs-template на актуальном скоупе): setDebug → initSDK → backButton.mount → initData.restore → miniApp.mount + themeParams.bindCssVars → viewport.mount. Mock окружения только при DEV (tree-shaken в проде): init data с `hash='dev-hash'` под dev-bypass бэкенда Фазы 0; `signature='dev-signature'` — схема launch params SDK 3.3.x требует поле signature. Отличия нового SDK от шаблона (@tma.js 3.0.8): `miniApp.mount()` внутри монтирует themeParams (двойной mount бросает «already mounting» — явный вызов убран, один mount на компонент); mount асинхронен (`await` перед `bindCssVars` — иначе «component is unmounted»); `mockTelegramEnv.onEvent` принимает кортеж `[method, payload]`, не `{name}`; AppRoot platform только `'base'|'ios'`; `retrieveRawInitData()` возвращает `string | undefined`. Все отличия задокументированы в коде.
- **Портировано из mini-app**: `api/client.ts` 1:1 (single-flight refresh, ban/session-expired подписки, бан-парсинг), `store/useAuthStore.ts` (та же статус-машина bootstrap/refresh/background/banned/deleted; payload сменён на `retrieveRawInitData()` — RAW-строка без пересортировки, иначе HMAC), QueryClient-конфиг ретраев. VK-специфика (vk-bridge, launch params, vk-mini-apps-router) вырезана полностью.
- **UI-шелл на telegram-ui**: AppRoot + AuthGate-эквивалент (спиннер/бан с причиной/удалён/ошибка с ретраем + подписки apiClient + visibilitychange) + заглушка главной «🚗 Едем» с именем авторизованного; `miniApp.ready.ifAvailable()` после монтирования; вне Telegram прод-сборка показывает EnvUnsupported.
- **Host-based раздача прод-статики** (backend `app.ts`): Host из `TELEGRAM_HOSTS` (`tg-edem.binetc.fun`) получает `telegram-app/dist`, остальные — `mini-app/dist`; SPA-fallback и API-404 сохранены для обеих веток. BotFather не трогали — кнопка @edem_mini_bot уже указывает на root домена. Docker: сборка telegram-app + COPY dist; compose прокидывает `TELEGRAM_HOSTS`. Root: workspace + `dev:tg` (Vite :3012, proxy /api→:3011) + `build:tg` (включён в общий `build`).
- **Проверки**: dev-флоу в headless Chromium — mock → dev-bypass → экран authenticated («Dev Telegram»), JS-ошибок нет; docker host-routing верифицирован по хэшам ассетов (TG `index-Db96N9ef.js` vs VK `index-CRqNeKdd.js`); публичный `https://tg-edem.binetc.fun/` отдаёт TG-сборку. Реальный токен убран из `backend/.env` (иначе отключает dev-bypass; прод-токен живёт только в root `.env` → compose).
- **Тесты**: `store/__tests__/useAuthStore.test.ts` (7: happy path, RAW-passthrough assert побайтово, бан с/без причины, удалён, SDK без init data, сетевая ошибка). Backend 465/465, root typecheck 0 ошибок.

#### Telegram Auth — Фаза 0 (переход на Telegram Mini Apps)

Стратегия: VK заморожен (тег `vk-final`; снапшот с полной git-историей — репо `user-for-download/vk-mini-app-edem`, push всех веток и тегов), активная разработка — Telegram. VK-код в этом репо не трогается до паритета telegram-app (мини-апп остаётся референсом для портирования), демонтаж — отдельной фазой после.

- **БД**: `User.telegramUserId BigInt? @unique` (миграция `20260909120000_add_telegram_user_id`). BigInt обязателен — id Telegram превышают Int32; nullable + unique (VK-легаси без TG-ид; уникальность — точка синхронизации параллельных запусков, зеркально vkUserId). Множество NULL в Postgres-unique не конфликтуют. Тестовая БД синхронизируется `db:test:push` (миграции на ней не разворачиваются — P3005 by design).
- **Backend `POST /api/v1/auth/telegram`** (в `authRouter`): тело `{ initData }` (RAW query-params строка от Telegram, пересортировка запрещена — HMAC не сойдётся). Порядок проверок зеркален `/auth/vk`: sanitize → Zod → верификация подписи → tombstone-проверка ДО upsert → upsert по `telegramUserId` с P2002-ретраем (Prisma upsert = SELECT→INSERT без ON CONFLICT) → бан-проверка ДО токенов (403 + `banReason` + отзыв всех активных refresh) → JWT access/refresh как у VK. Пустой `TELEGRAM_BOT_TOKEN` вне dev-режима → 503 «not configured» (роут выключен, как ADMIN_TOKEN; не 401 — клиенту не нужно сбрасывать сессию).
- **Валидация initData**: `@telegram-apps/init-data-node@2.0.10` — `validate(initData, TELEGRAM_BOT_TOKEN, { expiresIn: TG_INIT_DATA_TTL_SECONDS })`. TTL дефолт 3600с (не платформенные сутки): initData можно украсть и переиграть в окне валидности; длинную сессию держит refresh-ротация. Replay-кэш (как у VK) НЕ нужен — initData законно живёт в клиенте всю сессию Mini App. Нюансы пакета: runtime `parse()` отдаёт snake_case при camelCase-типах (каст к собственному `RawParsedUser`); `first_name` в valibot-схеме пакета обязателен — `parse()` бросает на подписанных данных без него → fail-closed try/catch (401, не 500).
- **Dev/test-режим**: без токена при `ALLOW_DEV_AUTH` — dev-bypass `hash=dev-hash` со строгим совпадением (`===`, near-miss «dev-hash-evil» отклоняется), user.id из JSON валидируется (safe positive integer, без дефолтов). Реальная HMAC-ветка покрыта юнит-тестами через `sign()` из того же пакета (валидная/битая подпись, просрочка, чужой токен, id > Int32).
- **Профиль (display)**: из подписанного user-объекта initData — но с той же санитизацией, что у VK (defense in depth): имя чистится от HTML, аватар только `https` + host-allowlist `t.me`/`telegram.org` (зеркало VK-CDN-политики). Placeholder «Пользователь Telegram <id>» дописывается реальным именем при следующем входе; вручную изменённое имя (PATCH /users/me) не перезаписывается; аватар ресинхронизируется при каждом входе. `telegramUserId` в API-ответы НЕ отдаётся (privacy-политика vkUserId; t.me-ссылки для связи — Фаза 2+).
- **Contracts**: `telegramAuthRequestSchema` (`initData` 1..4096, зеркально VK `searchParams`); ответ — существующий `authResponseSchema` без изменений.
- **Env**: `TELEGRAM_BOT_TOKEN` (опционален, намеренно НЕ secretEnv — эфемерный токен бессмыслен), `TG_INIT_DATA_TTL_SECONDS=3600`, `TG_AUTH_RATE_WINDOW_MS/TG_AUTH_RATE_MAX` (зеркало VK-лимитеров 5/5мин). Документировано в `backend/.env.example` и `.env.test`.
- **Тесты**: юнит `telegramSign.test.ts` (12: HMAC happy path, BigInt-id, битая подпись, TTL, чужой токен, без user, dev-bypass точность/невалидные id, fail-closed без dev-режима, production-off) + интеграционные `telegram-auth.test.ts` (12: happy path со схемой ответа, повторный вход = тот же юзер, placeholder-имя, ручное имя не трогается, аватар-синк/чужой домен, 400/401/403+бан с отзывом токенов, tombstone без мутации, P2002-гонка 10 раундов; BigInt-диапазон 9_900_000+ не пересекается с VK-диапазонами) + contracts `telegram-auth.dto.test.ts` (6). Backend 465/465, contracts 220/220, typecheck всех workspace — 0 ошибок.
- **Скилл `telegram-mini-app`** (`.opencode/skills/`): установлен из sickn33/agentic-awesome-skills, адаптирован под репо — актуальный скоуп `@telegram-apps/*` (шаблон Telegram-Mini-Apps/reactjs-template на устаревшем `@tma.js/*` не копировать), TON Connect не применим, auth-схема и VK-заморозка зафиксированы в «Repo integration notes».

#### Legal Audit Round 2 (повторный юридический аудит)

- **Consent timestamp (152-ФЗ ст. 9, доказуемость согласия)**: `User.consentAcceptedAt` — момент акцепта правовых документов. Проставляется в `POST /users/me/onboarding` (кнопка «Принять»), обнуляется при удалении аккаунта и админ-сбросе онбординга (повторный акцепт перезапишет). Forward-only миграция `20260908115000_add_user_consent_accepted_at`; `onboarding.test.ts` дополнен проверками timestamp (успех + сброс).
- **ConsentGate: честный отказ**: старый текст «аккаунт не создаётся, данные профиля не обрабатываются» был неверен — аккаунт создаётся при входе (`AuthGate` стоит выше гейта, `/auth/vk` пишет имя/фото/vkUserId до акцепта). Экран «Не принимать» теперь предлагает «Удалить мои данные» — реальный `DELETE /users/me` с переводом в терминальный статус `deleted` (у неакцептовавшего есть токены; 409 на активных обязательствах обрабатывается inline-ошибкой). Судьба профилей «отказавшихся и просто закрывших» — пункт в production-checklist (TTL/обезличивание).
- **PrivacyPanel §4**: добавлено раскрытие, которое код делает, а текст не упоминал — участникам одной поездки для связи виден идентификатор ВКонтакте (водителю — пассажиров, участникам активной брони — водителя; `includeVkUserId` в сериализаторах).
- **PrivacyPanel §7**: формулировка про журналы исправлена — vkUserId в логах (vk_push/ws) не обезличен, текст теперь честно перечисляет «идентификаторы событий и пользователей, в том числе идентификатор ВКонтакте, и IP-адрес».
- **TermsPanel §5**: «ответ приходит в приложение» было недостижимо для забаненного (403 на всех auth-эндпоинтах, включая `GET /feedback`) — теперь: «если блокировка будет снята, ответ будет доступен в приложении в разделе "Мои обращения"».

#### Legal Consent Gate (акцепт документов при первом входе)

- `ConsentGate` (`mini-app/src/components/ConsentGate.tsx`): блокирующий экран первого входа — акцепт Пользовательского соглашения и Политики конфиденциальности (152-ФЗ). Стоит между `AuthGate` и `WsProvider`: до нажатия «Принять» приложение не монтируется (навигация, WS, запросы). Слайды онбординга (логика из удалённого `useOnboarding`, App больше их не триггерит — он монтируется после согласия) показываются поверх экрана; сбой чанка слайдов не блокирует акцепт.
- Согласие фиксируется существующим механизмом: `POST /users/me/onboarding` с версией «2» — «Принять» единственный путь сохранения версии (просмотр/пропуск слайдов не считается). `ONBOARDING_VERSION` поднят с «1» до «2»: все существующие пользователи пройдут акцепт один раз; сброс онбординга из админки возвращает пользователя на экран (повторный акцепт новой редакции). После успешного POST стор обновляется напрямую и гейт пропускает дальше.
- Экран: сводка ключевых условий (платформа, не перевозчик; расчёты между пользователями; 14+; какие данные обрабатываются и передача в VK), ячейки-ссылки на полные тексты (переиспользованы ленивые `TermsPanel`/`PrivacyPanel` внутри собственной `View` — без роутера), «Не принимать» → объяснение «без согласия сервис недоступен» + «Вернуться», ошибка сохранения — inline с ретраем кнопкой.
- Tests: `ConsentGate.test.tsx` (4 SSR-теста: null-версия → экран согласия без контента приложения, старая «1» → повторный акцепт, «2» → проход, без пользователя → гейт прозрачен).

#### Log Retention (ротация логов из правовых требований)

- `docker-compose.yml`: якорь `x-logging` задаёт драйвер `json-file` с `max-size: 10m` / `max-file: 3` для db/backend/webapp (~30 МБ на сервис). Логи идут в stdout (pino/nginx/postgres), ограниченный объём = ограниченный срок хранения журналов с PII (ip в rate-limit/WS, vkUserId в vk_push) — раньше рост был неограниченным. Валидация `docker compose config` пройдена.
- `backend/ENVIRONMENT.md`: раздел «Logging and retention» — где реально живёт retention (инфраструктура, не приложение) и требование держать в согласии с Политикой; `production-checklist.md` — пункт проверки при запуске вне compose.
- `PrivacyPanel` §7: добавлен абзац про технические журналы (обезличенные идентификаторы, IP, ограниченный объём, автоматическая ротация).

### Removed

#### VK Platform Removal (удаление VK Mini App, tg-migration-24–26)

- **`mini-app/` workspace удалён целиком** (VKUI, vk-bridge, VK-роутер, все панели/тесты). Полная копия с git-историей — репо `user-for-download/vk-mini-app-edem`, в этом репо тег `vk-final` (заморозка Фазы 0).
- **Backend**: роут `/auth/vk`, `vkSign`/`vkProfile`, `vkPush`/`vkMessenger`, VK-вариант appeal (searchParams) и `vkUserId` из схем/DTO/сериализаторов/Sentry-скраббера удалены; миграция `20260910090000_drop_vk_user_id` (DROP INDEX `User_vkUserId_key` + DROP COLUMN). Tombstone-политика удалённых аккаунтов сохранена на `telegramUserId`.
- **Раздача статики**: Telegram-only — Host из `TELEGRAM_HOSTS` получает `telegram-app/dist`, остальные хосты 404 (`app.ts`); compose/CI/Dockerfile/.env.example синхронизированы (VK-переменные убраны, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_HOSTS` required).
- **Уведомления/контакт**: VK push и кнопка «Написать в VK» удалены вместе с платформой; доставка — in-app inbox + WebSocket hint (deep-link allowlist), фоновая Bot API-рассылка заблокирована ADR `telegram-notification-delivery` (продуктовое решение); механизм контакта участников — открытый продуктовый вопрос.
- **Миграция аккаунтов**: политика `account-migration-policy.md` — production-данных нет, корректный исход dry-run «migrate нечего» (writes=0), авто-линкинг запрещён; гейт удаления закрыт GO владельца 2026-09-10 (empty-prod exception, `docs/migration/vk-deletion-gate.md`).
- **E2E**: VK-сьюты `full-cycle`/`liquidity-safety` заменены на `telegram-parity` (16/16, браузерный dev-bypass флоу) + `telegram-realtime`; артефакты прогонов (`results*.json`, `shots*/`) игнорируются.
- **Verified**: typecheck всех workspace; тесты 234 contracts / 506 backend / 232 telegram-app / 8 webapp; `npm run build` + bundle budget (telegram-app 173.8 KiB, webapp 180.9 KiB initial gzip); `prisma validate`; e2e `telegram-parity` 16/16 (2026-09-10).

### Changed

#### Car Plate Optional (номер-примета опционален)

- Поле «Номер» в форме авто больше не обязательно: backend `carFormSchema.plate` — `optional()` (пустое/пробельное нормализуется в `null`, `""` не хранится), DB `Car.plate String?` (forward-only миграция `20260908111246_make_car_plate_optional`; заодно убран дрейфующий `User_deletedAt_idx`, которого нет в схеме).
- Сериализатор опускает ключ `plate` при `null` (контракт `carSchema` допускает только `string | undefined` — fail-closed валидация ответов). Публичные сериализаторы номер не отдавали и не отдают.
- Mini-app: `CarFormDto.plate?`, валидация формы без номера, плейсхолдер «Например: 583»; subtitle авто в профиле — только цвет, если номера нет (`TripCard`/`TripDetailsPanel` уже строили строку через `filter(Boolean)`).
- Создание поездки по-прежнему требует сам автомобиль (`NO_CAR`), номер не требуется.
- Tests: backend `car-optional-plate.test.ts` (+6: без номера → 200 без ключа + null в БД, с номером, пробельный → null, стирание номера обновлением, 400 на без model / plate > 15, 401 без токена).

#### Legal Texts Audit (Правовые тексты)

- **PrivacyPanel**: раздел приведён к фактическому поведению системы — добавлены блоки «Общие сведения» (оператор ПДн с плейсхолдерами `[...]`, возраст 14+) и «Кому передаются данные» (хостинг, VK push/сообщения сообщества — передача vkUserId и текста уведомления, Sentry в обезличенном виде); исправлен бывший §4 «не передаем данные третьим лицам», который противоречил реальности; добавлены разделы «Уведомления» (некритичные — по тумблеру, критичные — всегда; сообщества/push — разрешения VK), «Хранение и защита» (retention: пока аккаунт активен, авто-TTL нет) и «Удаление аккаунта» (что стирается, что остаётся обезличенным: история поездок/броней/отзывов/жалоб, vkUserId-надгробие против повторной регистрации, требование завершить активные поездки/брони); «Права пользователя» дополнены редактированием профиля в приложении, отзывом согласий и каналом appeal для забаненных.
- **TermsPanel**: добавлены возраст 14+ и отсылка к Политике/правилам ВКонтакте в «Общих положениях» (реквизиты оператора — плейсхолдеры); «Оплата» — сервис не участвует в расчётах; новый раздел «Модерация и блокировка» (модерация отзывов, бан с причиной, обжалование через экран блокировки); новый раздел «Применимое право и споры» (право РФ, претензионный порядок, суд по месту оператора); «Изменение условий» — публикация не позднее чем за 7 дней + акцепт продолжением использования.
- Редакция обоих документов: 8 сентября 2026 года. Оба файла сохраняют пометку «финализировать с юристом» (заполнить плейсхолдеры реквизитов); `production-checklist.md` — обновлённый пункт про правовые тексты (реквизиты, уведомление РКН, retention).

#### UI Consistency Fixes (стилистический аудит)

- **ReportModal**: сабмит приведён к единому модальному паттерну — sticky-футер (`Box` + `Separator` + `size="l" stretched` primary), как в CreateTrip/EditTrip/CarForm/EditProfile/Feedback/CreateReview; хвостовой `Spacing 24` удалён.
- **Banner actions**: NotificationsPanel — кнопкам явно проставлен `size="m"` (дефолт VKUI — `size="s"`, визуальный вес кнопок в баннерах HomePanel и Notifications расходился). Степперы мест «−/+» в CreateTripModal/EditTripModal — явно `size="s"` (размер больше не зависит от дефолтов версии).
- **Card**: из TripCard и карточки маршрута в TripDetailsPanel убраны ручные `borderRadius: 12`/`backgroundColor` (дубли токенов VKUI `mode="outline"`); остались только функциональные стили (`overflow: hidden` для обрезки по радиусу, cursor/opacity).
- **RouteLine**: цена — `Title level="3"` (токены 17/22 weight 600) вместо хардкода `fontSize: 18, lineHeight: "22px"`; Spacing вне шкалы приведены к 4-кратной (2→4, 6→8).
- **CityPickerField**: кастомные `span` в `bottom` FormItem заменены на строки/`Caption` — цвет ошибки красит штатный `.statusError .bottom`, helper — штатный серый (подтверждено по CSS VKUI).
- **AuthGate**: 3 экрана авторизации переведены с сырого `PanelHeader` на единый `AppPanelHeader`.
- **A11y/чистота**: избыточный `aria-label="Назад"` убран со всех 13 `PanelHeaderBack` (VKUI сам даёт accessible name через label); `Icon24FavoriteOutline`-ресайз 30 в CreateReviewModal задокументирован как осознанный (тарч-зона 46px); BookingRequestRow — subtitle без Caption-обёртки (RichCell красит сам), уникальный `mode="outline"` → `secondary` (симметрия пар «принять/отклонить»), косметика отступов.

#### VKUI Audit Fixes (adaptivity + a11y)

- `transformVKBridgeAdaptivity` приведён к официальному хелперу из инструкции интеграции VK Mini Apps (vkui.io): конвертация через библиотечные `getViewWidthByViewportWidth`/`getViewHeightByViewportHeight` + enum `ViewWidth`. **Behavior change:** адаптивный viewport теперь маппится по брейкпоинтам VKUI (320/768/1024/1280) — 320–767px = `MOBILE` (было `SMALL_TABLET`), 768–1023 = `SMALL_TABLET` (было `TABLET`), 1024–1279 = `TABLET` (было `DESKTOP`), с 1280 = `DESKTOP`; добавлен `viewHeight` (415/720) — раньше не передавался вовсе. `force_mobile_compact` теперь включает `density: "compact"` (v8: density вместо sizeX/sizeY — компактные отступы/высоты компонентов), `force_mobile` — явно `regular`. Устранены magic numbers 2/3/4/5.
- HomePanel «Поиск» (Search-имитация кнопки): `aria-label` перенесён в `slotProps.input` (паттерн migration-v8 — restProps идут в корень, поле оставалось без имени для скрин-ридеров), поле получает `tabIndex: -1` — единственный tab-stop остаётся корень с `role="button"` (нет вложенных интерактивов). Клик/Enter/Space — без изменений.
- Тесты модалок: документировано, почему `ModalRoot` в тестах легитимен (это внутренний рендерер `useModalManager` — его ContextHolder рендерит тот же ModalRoot; депрекация адресует ручной менеджмент в приложении).
- Tests: `transformVKBridgeAdaptivity.test.ts` переписан под официальные брейкпоинты (+4 кейса: SMALL_MOBILE < 320, DESKTOP ≥ 1280, границы высоты 415/720; force_mobile/compact — с density).

- `/ride-requests`: форма в стиле `CreateTripModal` — города через `CityPickerField` (поиск + `excludeCityId`, состояние `CityDto | null`), время через `DateInput` с `enableTime` + `disablePast` (внутри тот же `Calendar`; состояние `Date | null`). Семантика моментов не менялась (абсолютные Date → ISO, как раньше парс `datetime-local`; wall-clock сплит не нужен — API принимает ISO). Валидация и тексты ошибок без изменений.
- `/ride-requests` «Мои запросы»: элементы списка переведены с `FormItem` на `RichCell` — `overTitle` = статус («Активен»/«На паузе»/«Выполнен»/«Отменён»), `subtitle` = окно отправления, текст = маршрут, `actions` = горизонтальный `ButtonGroup` (пауза/возобновить + отмена только для active/paused). Поведение кнопок не менялось.
- Профиль → «поездки и бронирования»: новая ячейка «Мои запросы» (роль пассажира, иконка поиска) — переход на `/ride-requests` («Ищу попутку»).
- Профиль: «Удалить профиль» переехало из группы «опасная зона» (удалена) в шапку рядом с «Редактировать» (горизонтальный `ButtonGroup`, стиль tertiary negative). Двухшаговый confirm и текст про активные поездки/брони — без изменений.

### Added

#### Prod City Seed + Production Checklist

- `db:seed:cities` (`backend/prisma/seed-cities.ts` + root/backend npm-скрипты): наполняет справочник точек (25 городов) **без демо-данных** для прода — полный `db:seed` в проде запрещён (24 демо-юзера, 30 поездок). Идемпотентен (повтор — 0 изменений), админские города не трогает, PK существующих строк не переписывает (FK-безопасность, расхождение id только логируется); свежая БД получает детерминированные UUID v5 (контракт `createTripDtoSchema` требует uuid).
- `docs/deployment/production-checklist.md`: пошаговый чеклист релиза — предусловия (домен/TLS, VK-консоль, секреты, онбординг-изображения, правовые тексты), шаги деплоя (сборка → миграции → `seed-cities` → up), проверки после деплоя (health, админка, e2e, uptime-мониторинг), пост-релиз (Sentry, ротация ADMIN_TOKEN, rate-limits). README ссылается на чеклист из раздела деплоя.
- Verified: scratch-БД — 25 создано с нуля, повтор — 0 изменений, админ-город и переименованная строка обработаны корректно, PK-расхождение — warning без записи.

#### One Report Forever (лимит «1 жалоба навсегда»)

- `POST /api/v1/reports`: повторная жалоба на ту же связку (автор, тип объекта, объект) отклоняется `409 CONFLICT` при любой категории и любом статусе первой жалобы — включая `resolved`/`rejected`. Раньше дедуп ловил только открытые жалобы той же категории (обход: другая категория, повтор после рассмотрения).
- DB: `@@unique([reporterId, targetType, targetId])` + forward-only миграция `20260906115105_report_one_per_reporter_target` (удаляет частичный `Report_open_unique_idx`); pre-check упрощён до поиска любой жалобы тройки, catch `P2002`/`P2034` стал живым race-guard. Код ошибки `CONFLICT` не менялся.
- Mini-app `ReportModal`: подтекст 409 — «Повторная отправка недоступна»; кнопка отправки гаснет, если жалоба на объект уже есть в `GET /reports` (сервер — источник правды), а её подпись меняется на «Жалоба уже отправлена».
- Tests: backend `reports.test.ts` (+3: другая категория → 409, повтор после resolve → 409, гонка → 201+409 и одна строка); mini-app `ReportModal.test.tsx` (4 SSR-теста).

#### Trip Secondary Actions (inline-секция «Дополнительно»)

- Кнопки «Поделиться поездкой» / «Пожаловаться на поездку» живут в inline-секции «Дополнительно» внизу `TripDetailsPanel` (новый `TripSecondaryActions`: `ButtonGroup vertical` + 2× `secondary` кнопки с иконками `Icon20`). Kebab-меню в шапке (`PanelHeader after`, `TripActionsSheet mode="menu"`) удалено: верхний правый угол в VK Mini App занят системными кнопками клиента (закрытие и пр.), опция там перекрывалась. Хендлеры шеринга/жалобы переиспользованы без изменений.
- Tests: `TripActionsMenu.test.tsx` (секция + отсутствие kebab, SSR).
- Кнопка «Пожаловаться на поездку» видна только пассажирам с активной бронью: на свою поездку жаловаться нельзя (водитель исключён и на клиенте, и в `canReport` на бэкенде — `POST /reports` отвечает `403 FORBIDDEN`). Посторонним доступна только «Поделиться». `ReportModal` показывает на 403 понятный текст вместо generic-ошибки.
- Входная кнопка жалобы показывает отправленное состояние: если жалоба на поездку уже есть в `GET /reports`, в секции «Дополнительно» вместо «Пожаловаться на поездку» — погашенная «Жалоба уже отправлена», модалка вовсе не открывается (тот же источник правды, что в `ReportModal`).

#### Profile «Отзывы» Panel (SegmentedControl: Мои / О вас)

- Разрозненные секции отзывов в профиле («отзывы о вас» — 2 последних, «мои отзывы» — 3 последних) собраны в единый раздел «Отзывы» — отдельная панель `/profile/reviews` (ProfileView, lazy-chunk) с SegmentedControl по паттерну «История поездок» (`/bookings/history`):
  - **«Мои»** — все мои отзывы, включая ожидающие модерации (pending + published + rejected; `ReviewCard` показывает подписи «На модерации»/«Отклонён» для непубличных);
  - **«О вас»** — публичные отзывы о пользователе (`GET /reviews/user/:me`, только published), отфильтрованные по активной роли профиля — как у прежней секции.
- Профиль: вместо двух секций — одна клетка «Отзывы» (chevron) в группе «поездки и бронирования»; секции «поездки для отзыва» и CTA «Оставить отзыв» на месте (создание отзыва и e2e-сценарий не изменены).
- Без изменений API: вкладки строятся на существующих `GET /reviews/my` (отдаёт все статусы) и `GET /reviews/user/:userId` (published-only); запросы кешируются (кэш общий с ProfilePanel/DriverProfileModal). Пустое состояние с CTA «Оставить отзыв» (вкладка «Мои»), ошибка — «Попробовать снова», PullToRefresh, скелетоны `ReviewCardSkeleton`.
- Чистая логика вкладок — `helpers/reviewsTabs.ts` (`getReviewsForTab`, `REVIEW_TAB_OPTIONS`): unit-тесты без DOM; панель — SSR-рендер-тесты (конвенция репо без @testing-library).
- Tests: mini-app 126 (16 new: `reviewsTabs.test.ts` + `ReviewsPanel.test.tsx`).

#### Review Moderation (Модерация отзывов)

- Отзывы проходят админ-модерацию: новый отзыв создаётся со статусом `pending` («на модерации»), после чего администратор публикует его (`pending → published`) или отклоняет (`pending → rejected`). Approve/reject возможны только из `pending` (иначе `409 CONFLICT`); существующий `DELETE` работает из любого статуса и без изменений.
- Published-only: публичный `GET /api/v1/reviews/user/:userId` возвращает только `published` (pending/rejected скрыты); `rating`/`reviewsCount` пользователя агрегируются только по `published` — общий `recomputeUserRating` вызывается при **одобрении** (в той же Serializable-транзакции, что и смена статуса) и при **удалении**, но **не** при создании — pending-отзыв рейтинг не меняет.
- Admin API: `PATCH /api/v1/admin/reviews/:id/approve` (pending→published + пересчёт рейтинга + in-app уведомление автору `review_approved` «Отзыв опубликован»; 404 — отзыв не найден, 409 — статус не pending) и `PATCH /api/v1/admin/reviews/:id/reject` (pending→rejected, пересчёта нет, уведомление `review_rejected` «Отзыв отклонён»; 404/409 те же). `GET /api/v1/admin/reviews?status=pending|published|rejected` — необязательный фильтр; `AdminReviewDto` теперь включает `status`. Уведомления не критичные (подчиняются тумблеру `notificationsEnabled`), deep-link ведёт в «Мои отзывы».
- Mini-app: секция «Мои отзывы» в `ProfilePanel` — свои отзывы со статусом, до 3 последних (`GET /api/v1/reviews/my` теперь отдаёт `status` у каждого отзыва); `ReviewCard` показывает подпись статуса («На модерации»/«Отклонён») только для непубличных — в публичных списках (только published) её нет.
- Webapp: страница «Отзывы» — колонка «Статус» (бейджи: pending amber, published green, rejected red), кнопки «Одобрить»/«Отклонить» для pending (инвалидация кэшей списка + дашборда, sonner-тосты) и фильтр по статусу.
- DB: `Review.status String @default("pending")` + индекс `(targetUserId, status)` (миграция `20260903090000_add_review_status`); существующие отзывы backfill'ены в `published` — рейтинг не меняется.
- Contracts: `REVIEW_STATUS`/`REVIEW_STATUSES` в `status.const.ts`; `status` добавлен в `reviewSchema` (read) и `adminReviewDtoSchema`; опциональный `status` в `adminReviewsQuerySchema`.
- Docs: `docs/api/reviews.md` (статусы, published-only, лимиты), `docs/api/admin.md` (approve/reject + фильтр), `README.md`, `MEMORY.md`.
- Tests: backend 312 (17 new: `review-moderation.test.ts` + дополнения существующих сьютов), contracts 192 (31 new), mini-app 110 (13 new: `ReviewCard`, `CreateReviewModal`).

#### City Picker (VKUI `CustomSelect`) + Route Locking in Trip Edit

- Поля «Откуда/Куда» в `CreateTripModal`/`EditTripModal` теперь — VKUI `CustomSelect`-дропдаун (без третьего уровня модалки): один тап открывает searchable-дропдаун (подстрока, `filterFn`), выбор → готово. Справочник грузится одним запросом (`useAllCitiesQuery`, `staleTime: Infinity`), фильтрация — клиентская (O(N) по 25–200 городам — незаметно).
- `CityPickerField` получил `excludeCityId`: в `CreateTripModal` поле «Откуда» скрывает выбранный «Куда» (и наоборот) — UX-страховка, подкреплённая серверным refine `fromCityId !== toCityId`. Текущий выбранный город помечен `disabled` в options.
- **Маршрут заблокирован в `EditTripModal`:** поля `disabled` + helperText «Маршрут нельзя изменить после создания…»; внизу формы — «Опасная зона» с кнопкой «Удалить поездку» (активна только при `status === "active"` и отсутствии активных броней), использующей `PATCH /trips/:id/cancel`.
- Backend отвергает смену маршрута в `PATCH /trips/:id`: `updateTripDtoSchema = baseTripSchema.partial().omit({ fromCity, fromCityId, toCity, toCityId }).strict()` — эти поля в теле PATCH → `400`. Бэкенд больше не резолвит FK и не декрементит `tripsCount` в PATCH (код удалён).
- `citySuggestQuerySchema.q` стал опциональным (пустое/отсутствующее → весь справочник); `CITY_SUGGEST_LIMIT_MAX` поднят 20 → 100 для клиентской загрузки всего списка.
- Бандл: 271 KiB initial gzip (было 316 — минус 45 KiB после удаления `CityAutocomplete`/варианта `ModalPage`). Под лимитом 330 KiB.
- Docs: `docs/api/admin.md` (эндпоинты городов), `MEMORY.md` (раздел City Picker + Locked Route).

#### City Directory (Справочник точек) + Trip Form Autocomplete

- Админский справочник точек для малого городка. UI мини-апа **не позволяет** вводить город вручную — только выбор из справочника. Место посадки (адрес) остаётся свободным текстом водителя.
- 25 точек Вологодской области засеяны идемпотентно в `prisma/seed.ts` (`seedCities`, `findFirst` по `nameNormalized` + create/update). Повторный запуск seed не пересоздаёт города и не трогает админские правки.
- Soft-reference: `Trip.fromCity`/`toCity` остаются строками-снимками (источник правды для UI/поиска/уведомлений); новые nullable FK `Trip.fromCityId`/`toCityId` → `City` (`ON DELETE SET NULL`, денормализованный `City.tripsCount`).
- DTO ужесточены: `createTripDtoSchema`/`updateTripDtoSchema` требуют `fromCityId`/`toCityId` (`z.string().uuid()`) + refine `fromCityId !== toCityId`. Старые клиенты без `fromCityId` → `400 VALIDATION_FAILED`. Неизвестный город (404 на `findUnique`) → `400 CITY_NOT_FOUND`.
- Публичный `GET /api/v1/cities/suggest?q=&limit=` (без auth, IP-лимит, `mode: "insensitive"` contains). Админ `GET/POST/PATCH/DELETE /api/v1/admin/cities` (adminGuard, mutationLimiter); `409` на дубликат имени; `409` на удаление используемого города (`tripsCount > 0`).
- `tripsCount` инкрементируется при создании Trip (Serializable tx), декрементируется при смене FK через PATCH. Отмена поездки счётчик не меняет.
- Contracts: `city.schema.ts` + `city.dto.ts` (`CITY_NAME_MAX_LENGTH = 100`, `CITY_SUGGEST_LIMIT_MAX`, хелперы `normalizeCityName`/`cityNameNormalized`). Уникальный индекс `City_nameNormalized_key` создаётся SQL-миграцией (Prisma не поддерживает unique с выражением).
- Webapp: страница `/cities` (поиск с дебаунсом 300 мс, пагинация, диалоги создания/переименования/удаления; удаление заблокировано в UI при `tripsCount > 0`).
- Docs: `docs/api/admin.md` (эндпоинты городов).

#### Admin Feedback Reply (Support Loop)

- Админ теперь может ответить на обращение в поддержку — замыкается цикл «пользователь → админ → пользователь». `Feedback.reply String?` + `Feedback.repliedAt DateTime?` (+ индекс по `repliedAt` для будущих метрик «ожидают ответа»). `repliedAt` — аудит **первичного** ответа, при правке не двигается.
- Admin API: `GET /admin/feedback/:id` (детальная карточка, 404 для неизвестного id); `POST /admin/feedback/:id/reply` (первичный ответ — создаёт in-app уведомление `feedback_replied`, `400` если ответ уже есть → используйте PUT); `PUT /admin/feedback/:id/reply` (редактирование, не двигает `repliedAt`, `400` если ответа ещё нет → используйте POST). Тело `feedbackReplyBodySchema` `{ reply }` (trim, 1–2000). Список `GET /admin/feedback` теперь включает `reply`/`repliedAt` в элемент.
- User API: `GET /api/v1/feedback` — собственные обращения авторизованного пользователя (новые первыми, bare array) с `reply`/`repliedAt` (`UserFeedbackDto`).
- Mini-app: раздел «Мои обращения» в SupportPanel + read-only модалка деталей (`useMyFeedbacksQuery`); инвалидация кэша после успешной отправки. Webapp: master-detail с формой ответа/редактирования (счётчик символов + валидация).
- Docs: `docs/api/admin.md` (эндпоинты reply + поля списка), `docs/api/feedback.md` (`GET /api/v1/feedback` + поля reply).

#### Real VK Push Notifications For Key Events

- Реальные push-уведомления VK на ключевые события: подтверждение/отклонение брони (пассажиру), отмена поездки (пассажирам), завершение поездки (пассажирам + водителю). Доставляются через `notifications.sendMessage` (серверный метод, **сервисный ключ** мини-аппа), приходят даже при закрытом приложении. Это **отдельный** механизм от уже существующих сообщений сообщества (`messages.send`, `VK_GROUP_TOKEN`) — оба могут сосуществовать.
- Backend: новый fail-safe сервис `services/vkPush.ts` (`sendVkPush(vkUserId, message, fragment?)`, таймаут 8 с, глотает ошибки) + env `VK_SERVICE_KEY` (опц., не задан → push не отправляются, остальной бизнес-флоу не ломается). Подключён в `createNotification` для `CRITICAL_NOTIFICATION_TYPES` (покрывает бронирования, поездки и фоновый worker автозавершения без правки каждого call-site'а — кроме добавления `fragment` для deep-link). В call-sites передаются маршруты мини-аппа для `fragment`: `/bookings` (бронь/отмена), `/bookings/history` (завершение → отзыв), `/trips/my` (водителю при автозавершении). Роутер `createHashRouter` — `fragment` попадает в hash, никаких изменений в deep-link-парсере не требуется.
- Mini-app: `requestNotificationsPermission` в `helpers/bridge.ts` (VK Bridge `VKWebAppAllowNotifications`, graceful `unsupported/cancelled/failed/success`). `NotificationsPanel`: отдельный блок «Push-уведомления VK» — читает текущий статус из `vk_are_notifications_enabled` (паттерн гонки с таймаутом 3 с, как в `useAuthStore`, чтобы UI не зависал вне VK) и предлагает «Включить»/показывает «Включены». После успешного запроса — оптимистичное обновление статуса.
- Безопасно: критичные уведомления (и push) создаются/доставляются **независимо** от персонального тумблера `notificationsEnabled` (бизнес-контракт). VK push дополнительно не зависит от тумблера — это реальные «критичные» события. Сообщество-сообщения и push — два независимых согласия (отдельные UI в `NotificationsPanel`).
- Внешняя настройка (one-time): получить сервисный ключ в консоли VK (dev.vk.com → Настройки мини-аппа → Сервисный ключ) и задать `VK_SERVICE_KEY` в `backend/.env` / root `.env`. Без ключа push не отправляются (приложение работает).
- Docs: `backend/ENVIRONMENT.md` (раздел «VK push notifications»), `README.md` (feature + env-таблица), `MEMORY.md`.
- Tests: backend 248 (12 new: 7 `vkPush.test.ts` + 5 `notification-push.test.ts`), contracts 100, mini-app 89 (5 new: `requestNotificationsPermission` в `bridge.test.ts`).

#### VK Direct Message «Написать в VK» Button

- Координация между водителем и пассажиром через уже существующие личные сообщения ВКонтакте (свой чат не строится). После создания брони и после подтверждения рядом появляется кнопка «Написать в VK», открывающая диалог с контрагентом: `https://vk.com/im?sel={vkUserId}` через существующий `openExternalUrl` (`VKWebAppOpenUrl` + браузерный фолбэк). Подпись явно указывает, что переписка откроется во ВКонтакте, а не в приложении.
- Дозированная выдача `vkUserId` (по аналогии с точными адресами встречи, fail-closed): поле добавлено в `userSchema` (optional positive int) и отдаётся только участникам активной брони — `GET /trips/:id` (driver.vkUserId при `canSeePrivateDetails`), `GET /bookings/my` (driver.vkUserId), `GET /bookings/trip/:tripId` (passenger.vkUserId, эндпоинт и так только для водителя). В публичные выдачи (поиск поездок, публичные профили, отзывы, `/bookings/history`) поле не попадает. Сериализаторы получили опцию `includeVkUserId` (по умолчанию `false`; кладётся только при non-null).
- Mini-app: новый чистый хелпер `helpers/vkLink.ts` (`buildVkMessageUrl` + `openVkMessages`). Кнопка «Написать в VK» показывается только при активном статусе (pending/confirmed) и наличии `vkUserId` в четырёх точках: `TripDetailsPanel` (пассажир, рядом с «Отменить бронирование»), `PassengerTripCard` («Мои брони»), `BookingRequestRow` («Заявки» водителя), `TripPassengerRow` (подтверждённые пассажиры в деталях рейса водителя).
- Tests: backend 236 (10 new: `vk-dm-disclosure.test.ts`), contracts 100 (4 new: `user.schema.test.ts`), mini-app 84 (11 new: `vkLink.test.ts`, `vkWriteButton.test.tsx`).

#### Ban Screen Feedback Appeal

- Ban screen «Обратная связь»: the «Обновить» button on the banned screen is replaced with a single «Обратная связь» button (mode primary) that opens the existing `FeedbackModal` with the subject pre-filled «Обжалование блокировки» (`openFeedbackModal(modalApi, { initialSubject })`, `FeedbackModal.initialSubject?` prop — `SupportPanel` usage unchanged).
- Public appeal endpoint `POST /api/v1/feedback/appeal` (no auth — banned users have no token): the body `{ searchParams, subject, text }` is validated by `feedbackAppealDtoSchema` (searchParams ≤ 4096, subject/text reuse `FEEDBACK_SUBJECT_MAX_LENGTH`/`FEEDBACK_TEXT_MAX_LENGTH`); identity is proven by the signed VK launch params via `verifyVkLaunchSignature` (the same check as `/auth/vk`, dev-sign accepted under `ALLOW_DEV_AUTH`) — no tokens are issued. Unknown signature → 401, unknown user → 404, invalid body → 400 `VALIDATION_FAILED`. Dedicated rate limiter: 5 requests/hour per IP (429 beyond). The feedback row is linked to the resolved user, so the admin panel sees who wrote it.
- Mini-app: `useAuthStore.launchParams` stores the VK launch-params string on the banned path; `useCreateFeedbackMutation` routes automatically — token present → `POST /feedback`, no token → `POST /feedback/appeal` with the stored launch params (no token + no launch params → graceful error snackbar).
- Docs: new `docs/api/feedback.md` (user feedback endpoints).
- Tests: backend 226 (17 new: `feedback-appeal.test.ts`), contracts 96 (13 new: `feedbackAppealDtoSchema`), mini-app 73 (10 new: `useFeedbackQuery.test.ts`, `feedbackModal.test.ts`, `AuthGate.test.tsx`).

#### Ban Reason And Banned-User Screen

- Ban reason is persisted: `User.banReason String?` (migration `20260827120000_add_user_ban_reason`; `null` for bans made before this feature). The admin user payload (`serializeAdminUser`/`adminUserDtoSchema`) now includes `banReason: string | null`.
- Login-time ban enforcement: `POST /auth/vk` checks `bannedAt` after the user upsert (covers both real VK and dev-auth flows) and rejects banned users with `403 { code: "FORBIDDEN", message: "Account is banned", banReason: string | null }` — no tokens are issued and all active refresh tokens are revoked (`revokeAllActiveTokens`). `POST /auth/refresh` returns the same 403 shape including `banReason` in both the regular and dev-mock branches.
- Admin ban requires a reason: `PATCH /admin/users/:id/ban` takes `{ reason }` validated by `banUserBodySchema` (trim, 1–500 chars, `.strict()` — extra fields rejected). Invalid/missing reason → `400 { code: "VALIDATION_FAILED", message, errors }`. A valid ban persists `bannedAt` + `banReason`, immediately closes the user's open WebSocket connections (`4403`), and does NOT auto-cancel their trips. Re-banning is idempotent and overwrites both the timestamp and the reason. `PATCH /admin/users/:id/unban` clears both `bannedAt` and `banReason`.
- Mini-app: new auth status `banned`. Bootstrap recognizes the 403 `FORBIDDEN` response and `AuthGate` renders a ban screen instead of the app: «Аккаунт заблокирован», «Причина: {banReason ?? "Причина не указана"}» and a «Обратная связь» button (see Ban Screen Feedback Appeal). A mid-session ban also lands on the screen immediately: WS close `4403` → refresh 403 → `apiClient.onBanned` event.
- Webapp: banning now happens via a modal with a required reason textarea (1–500 chars, live counter, validation) instead of a confirm dialog; the users list shows `banReason` with the fallback «Причина не указана». Unban is unchanged.
- Tests: backend 209 (25 new: `auth-ban-reason.test.ts`, `admin-ban-reason.test.ts`), contracts 83 (18 new: `admin.schema.test.ts`), mini-app 63 (15 new: `useAuthStore.test.ts`, `client.test.ts` extensions).

#### Admin Panel (`webapp/` workspace)

- New `webapp/` workspace: admin panel on React 19 + Vite 6 + Tailwind 4 + shadcn/ui + TanStack Router/Query. Sections: Dashboard (metrics), Users (search, ban/unban), Trips (filter, admin cancel), Bookings (filter, status override), Reviews (delete), Settings (read-only env snapshot). Dev server runs on port **3013** and proxies `/api` to the backend, so admin auth cookies are same-origin.
- Admin API under `/api/v1/admin`: dashboard metrics; paginated users/trips/bookings/reviews; `PATCH /users/:id/ban|unban`; `PATCH /trips/:id/cancel`; `PATCH /bookings/:id/status`; `DELETE /reviews/:id`; `GET /settings`. Admin trip cancel changes status only (no booking cascade); admin ban does NOT auto-cancel the user's trips.
- Admin auth: single-field login with the static `ADMIN_TOKEN` (`POST /api/v1/admin/auth/login`, wrong token → 401). On success the backend sets an **httpOnly cookie** `edem_admin_jwt` with a 12-hour JWT (`type=admin-access`, `sub=admin`, TTL via `ADMIN_JWT_TTL_SECONDS`); the token never touches localStorage or JS. `GET /auth/session` reports session state for the frontend route guard (always 200); `POST /auth/logout` clears the cookie. Guarded endpoints return **401** without a valid session.
- Admin panel is closed by default: with `ADMIN_TOKEN` unset every admin request (including login) gets 403 in all environments.
- Admin login is rate-limited against brute force: `ADMIN_LOGIN_RATE_WINDOW_MS`/`ADMIN_LOGIN_RATE_MAX` (default 5 requests / 5 minutes per IP).
- User ban: `User.bannedAt DateTime?` (migration `20260825142000_add_user_banned_at`); `requireAuth` rejects banned users with 403 on every authenticated endpoint.
- Admin contracts in `packages/contracts`: query/body schemas and DTOs (`adminLoginBodySchema`, `adminLoginResponseSchema`, `adminSessionResponseSchema`, paginated admin DTOs).
- Backend integration suite `admin-auth.test.ts` (18 tests): login ok/wrong/invalid/disabled, Secure-flag handling via `X-Forwarded-Proto`, session states, guard cookie verification incl. user-token type-confusion rejection, logout idempotency.

#### Admin Panel Production Deployment

- `docker-compose.yml` now ships the admin panel: new `webapp` service (multi-stage `webapp/Dockerfile`: vite build → `nginx:1.27-alpine`) serving `webapp/dist` on published port **3014** (`WEBAPP_BIND_ADDR` in root `.env`, default `127.0.0.1`). The embedded nginx config (`webapp/nginx.conf`) serves the SPA with `index.html` fallback and proxies `/api` to `backend:3000` inside the docker network, keeping the `edem_admin_jwt` cookie same-origin.
- `docker-compose.yml` passes `ADMIN_TOKEN` / `ADMIN_JWT_TTL_SECONDS` to the backend (empty `ADMIN_TOKEN` keeps the panel disabled).
- Admin cookie `Secure` flag is now derived from `X-Forwarded-Proto` (the webapp nginx forwards the upstream value or the connection scheme): HTTPS → `Secure`, HTTP → no `Secure`, so admin login works on HTTP-only domains behind a proxy. Without the header the previous behavior applies (`secure = isProduction`).

#### Onboarding (Mini App)

- First-launch onboarding via VK Bridge `VKWebAppShowSlidesSheet` (native information screens): 3 slides — «Находите поездки», «Бронируйте места», «Оставляйте отзывы». Shown once after the first successful auth (mini-app `App` renders inside `AuthGate`); any outcome (viewed all / skipped / closed / method unsupported / error) marks onboarding done, following the VK recommendation not to re-push skipped onboarding. The done flag is stored in VK cloud storage (`VKWebAppStorageSet`, per user+app) with a `localStorage` fallback. Slide images are temporary placeholders (832×555, 1.5:1, ≤ 500 KB per VK requirements) loaded as base64 via Vite `?inline` imports; slides live in a lazy chunk, so the initial bundle is unaffected (bundle budget check passes). Bridge wrappers `showSlidesSheet` / `vkStorageGet` / `vkStorageSet` never throw — unavailability degrades to `unsupported`/`failed`/`null`/`false`.

#### Onboarding Flag Backend + Admin Reset

- The onboarding done-flag moved from VK cloud storage (`VKWebAppStorageSet` with a `localStorage` fallback) to the backend: `User.onboardingVersion String?` (migration `20260827101541_add_user_onboarding_version`). The mini-app compares the stored version with its own `ONBOARDING_VERSION` (`mini-app/src/onboarding/version.ts`, pure `shouldShowOnboarding` helper) and completes onboarding via `POST /api/v1/users/me/onboarding` (auth required, `mutationLimiter`, body `{version}` — trimmed string 1..50 chars, otherwise 400 "Invalid payload"); the serialized user (`serializeUser`/`userSchema`) now exposes `onboardingVersion` (`null` = not completed or reset). Versioning: bumping `ONBOARDING_VERSION` makes ALL users see the new slides once. The VK storage bridge helpers `vkStorageGet`/`vkStorageSet` and `onboardingStorage.ts` were removed.
- Admin reset: `PATCH /api/v1/admin/users/:id/onboarding-reset` (admin-cookie guard, 404 for a missing user, idempotent) nulls `onboardingVersion` so the user sees the slides again on next launch; the webapp Users page adds a «Сбросить онбординг» action with a confirm dialog (`resetOnboarding` API method + `useResetOnboardingMutation`).
- Contracts: `completeOnboardingBodySchema` (`{version}`, `.strict()`, trim + min 1 + max 50) and `userSchema.onboardingVersion` (nullable optional string). Tests: integration suite `onboarding.test.ts` (auth, validation, persistence, admin guard/404/reset) and extended contract tests in `user.schema.test.ts`.

#### Feedback (Обратная связь)

- Support feedback form in the mini-app: Профиль → Помощь и поддержка → «Связаться с нами» → button «Обратная связь» (replaces the former placeholder text). Opens a `ModalPage` form styled like EditProfileModal (header with close button, `Group` with FormItems, sticky bottom submit): «Тема» input (≤ 100 chars) + «Сообщение» textarea (≤ 2000 chars, live counter) + «Отправить». Success/error snackbars; client-side validation mirrors the contract limits (`FEEDBACK_SUBJECT_MAX_LENGTH` / `FEEDBACK_TEXT_MAX_LENGTH` exported from `@edem/contracts`). The modal chunk loads lazily (`openFeedbackModal` helper, `loadModule` pattern).
- New backend endpoint `POST /api/v1/feedback` (auth required, `mutationLimiter`, DOMPurify sanitization, zod validation, trim before save, business event `feedback.created`) and Prisma model `Feedback` (`id, userId, subject, text, createdAt`, cascade delete with user, index on `createdAt desc`) — migration `20260826112025_add_feedback`.
- Admin panel: new read-only section «Feedback» (`/feedback`, LifeBuoy icon in the sidebar) listing submissions newest-first with offset pagination (date, user, subject, message), backed by `GET /api/v1/admin/feedback` (admin-cookie guard, `adminFeedbackQuerySchema`, `AdminPaginatedFeedback` DTO, `serializeAdminFeedback`).
- Contracts: `feedback.dto.ts` (`createFeedbackDtoSchema`, `createFeedbackResponseSchema`, length constants) + admin feedback DTO/query schemas; 13 new contract tests. Integration tests: `feedback.test.ts` (9) and `admin-feedback.test.ts` (6).

#### Full-Cycle E2E

- `e2e/full-cycle.mjs` (Playwright + Chromium): 14-step driver→passenger flow — driver auth, search accordion, trip creation, passenger search and booking, driver confirmation, snackbar/status checks, trip completion, passenger review. Artifacts: `e2e/shots/`, `e2e/results.json`.

### Changed

#### Bun Install (быстрая установка зависимостей)

- CI `checks` ставит зависимости через `bun install --frozen-lockfile` (+ кэш `~/.bun/install/cache`) вместо `npm ci`: ~10 с против ~минуты. Рантайм везде остался Node 22 (сборка/тесты без изменений).
- `bun.lock` (мигрирован из `package-lock.json`) убран из `.gitignore` и закоммичен; `package-lock.json` оставлен как npm-фолбэк. README обновлён (`bun install` в quickstart/сборке/деплое).
- Временная `install-benchmark`-джоба оставлена для сравнения замеров; под снос после серии зелёных прогонов.

#### Seed Coverage (заявки, жалобы, города, демо-пользователи)

- `backend/prisma/seed.ts`: 5 заявок (`active`/`paused`/`fulfilled`/`expired`), 4 жалобы (все статусы модерации, уникальные тройки), линковка поездок на справочник (`fromCityId`/`toCityId`, 30/30) + пересчёт `City.tripsCount` по не-отменённым, демо-пользователи `u-23` (бан с причиной) и `u-24` (soft-delete), отменённая бронь с причиной, cleanup и stats покрывают новые таблицы, `validateSeedData` проверяет новые сущности (включая уникальность троек жалоб).

#### Prisma 5.22 → 7 Upgrade (driver-адаптер + prisma.config.ts)

- Бэкенд переехал на Prisma ORM 7 (7.10.x): `prisma ^7`, `@prisma/client ^7`, `@prisma/adapter-pg ^7`, `pg ^8` (workspace `backend`). Rust-движок удалён — клиент генерируется чистым TS, бинарных движков нет (в alpine-образе `binaryTargets` больше не нужны).
- `datasource.url = env("DATABASE_URL")` из схемы удалён (в v7 не поддерживается): URL переехал в **`backend/prisma.config.ts`** (`defineConfig` из `prisma/config`; `datasource.url` с placeholder-фолбэком, чтобы `prisma generate` работал без окружения, например при сборке Docker-образа). `.env` в v7 **не подгружается автоматически** (ни CLI, ни клиентом): конфиг явно читает `backend/.env` (путь относительно файла), `seed.ts`/`drop-tables.ts` — аналогично, приложение — через `env.ts`.
- Генератор: `prisma-client-js` → **`prisma-client`** (ESM): вывод в **`backend/src/generated/prisma`** (gitignored, компилируется tsc в `dist`); все 19 импортов бэкенда теперь из `.../generated/prisma/client.js`; рантайм — `@prisma/client` v7 (`runtime/client`).
- Подключение — через **pg driver-адаптер** `PrismaPg` в `src/db.ts`: `max: 10`, `connectionTimeoutMillis: 10_000` (node-pg игнорирует стартовые параметры Rust-движка `connection_limit`/`pool_timeout` из URL, поэтому пул задан в коде; `statement_cache_size` в CI-URL тоже no-op).
- **Изменилась форма `meta` у P2002**: `meta.target` (поля индекса) больше не отдаётся — данные PG-драйвера теперь в `meta.driverAdapterError.cause` (`originalCode: 23505`, `constraint.index` — ИМЯ нарушенного unique-индекса). Классификация гонок броней (POST /bookings, админская смена статуса брони) — по имени индекса через `getUniqueConstraintName()` (`src/utils/prisma-errors.ts`): `active_seat_booking` → SEAT_TAKEN/идемпотентный 200, `active_passenger_booking` → ALREADY_BOOKED, остальное — общий 409. Прочие проверки P2002/P2034 используют только `error.code` — без изменений.
- В v7 `migrate dev`/`db push` больше не запускают `prisma generate` автоматически, а `@prisma/client` — не генерируется при установке: скрипты `db:migrate`/`db:push`/`db:push:force`/`db:test:push` цепляют `&& prisma generate`; корневые `npm run dev`/`npm run build` вызывают `db:generate` на старте (после `git pull` с изменённой схемой — `npm run db:generate`).
- Dockerfile (prod): stage 2 копирует `backend/prisma.config.ts` в `/app` (`CMD` `npx prisma migrate deploy` читает его; URL — из docker-compose). tsconfig бэкенда: `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` (внутренние импорты сгенерированного клиента используют расширение `.ts`).
- Node ≥ 22 теперь жёстко требуется для бэкенда (engines + зависимости Prisma 7).
- Verified: `prisma validate`, `db:push` (dev и test БД — «already in sync»), `tsc --noEmit` (все воркспейсы), backend-тесты 313/313 (edem_test), `npm run build`, smoke собранного dist на Node 22 (health + GET /trips через адаптер, graceful shutdown), `docker build` + `prisma validate` внутри образа, `format:check`.

#### Review Length Limit + Popover Removal

- Лимит текста отзыва: `REVIEW_TEXT_MAX_LENGTH = 150` (константа в `packages/contracts`, экспорт из `@edem/contracts`) enforced **на запись** — `createReviewDtoSchema.text` теперь `.trim().min(1).max(150)`. Read-схема `reviewSchema.text` намеренно остаётся `max(1000)` — терпимая и неблокирующая (fail-closed) для существующих отзывов.
- Mini-app `ReviewCard`: полный текст отзыва — в multiline `SimpleCell` (перенос строк, без ellipsis); **Popover с полным текстом удалён** (и chevron) — при лимите 150 символов текст занимает ~3 строки на телефоне, карточка самодостаточна.
- `CreateReviewModal`: лимит 150 через импорт константы из contracts (вместо локального 1000), живой счётчик `N/150` (красный за 50 символов до лимита), валидация «Максимум 150 символов»; success-снэкбар — «Отзыв отправлен на модерацию» («Он появится в профиле после одобрения»).

#### Drop Pending Verification (VK auth = verified)

- Ручная модерация верификации (none/pending/rejected → approved) больше не нужна: аутентификация через подписанные VK launch-параметры — это и есть верификация. Prisma: drop `User.verificationStatus`; `isVerified` по умолчанию `true`; `verifiedAt` проставляется при upsert в `/auth/vk` (defensive backfill `isVerified=true` для старых строк выполняется перед drop колонки).
- Backend: удалён `POST /me/request-verification`; auth upsert всегда верифицирует пользователя. Contracts: убраны `verificationStatus` / `verificationStatusSchema` из `userSchema` + `adminUserDtoSchema`.
- Mini-app ProfilePanel: убрана кнопка «Пройти верификацию» и ветка «На рассмотрении» — всегда «Личность подтверждена ВКонтакте». Webapp UsersPage: убрана колонка «Верификация» и бейджи.

#### Vite 6 → 8 (Rolldown + Oxc) + Dependency Bumps

- `vite` 6.2.3 → **8.2.2** (root + webapp; mini-app — hoisted в root): сборка теперь на бандлере **Rolldown** + **Oxc**. Функциональная форма `manualChunks` → `build.rolldownOptions.output.codeSplitting.groups`; `__dirname` → `import.meta.dirname`; `esbuild` убран из root devDeps (его заменил Rolldown). `@vitejs/plugin-react` остаётся 5.2.0 (peer уже поддерживает vite 8). Время сборки 12.3 с → 1.3 с; initial JS −40 kB.
- Фикс только для dev: consistent CJS interop в Vite 8 (importer `type:module`) делал default-экспорт `@vkontakte/vk-bridge-mock` (его `browser: UMD`-сборка) целым объектом `exports`, ломая `bridgeMock.send`/`isWebView` в dev-окружении. Алиас на чистый ESM-вход `dist/index.es.js` в `mini-app/vite.config.ts`. Prod-сборка не затронута (реальный `@vkontakte/vk-bridge` — чистый ESM).
- Обновление зависимостей (патчи/миноры, без breaking changes): `@sentry/node` + `@sentry/react` 9 → **10.73.0** (используются только `init`/`capture*`/`ErrorEvent` — код-совместимо, OTel v2 подтянут автоматически), `@vkontakte/vkui` 8.3.1 → 8.4.0, `@vkontakte/icons` 3.64 → 3.68, `hono` 4.12 → 4.13.5, `jose` 6.2.8 → 6.2.10, `zod` 4.4.3 → 4.5.4, `zustand` 5.0.14 → 5.0.15, `tsx` → 4.23.13, `vitest` 4.1.10 → 4.1.11, `@tanstack/react-query` 5.101 → 5.102.8. Корневой `package.json` (манифест унификации версий) синхронизирован с воркспейсами.

#### Mini-app UI Rework (reviews + driver rows)

- Карточка отзыва переосмыслена: строка `SimpleCell` (полный текст — в multiline-режиме; Popover с полным текстом, добавленный в этом же цикле, удалён фичей модерации — см. «Review Moderation» в Added); оценка показывается кубиком `Dice` по значению (1–5); исправлено переполнение `Box` в VKUI 8.4.
- `BookingRequestRow` («Заявки» водителя) и `TripPassengerRow` (подтверждённые пассажиры) переведены на единый `RichCell`-шаблон: аватар в `before` (у пассажира + рейтинг `Avatar.Badge`), имя + «Место N» в `overTitle`, комментарий/маршрут в `subtitle`, кнопка «Написать в VK» в `after` (pending/confirmed + наличие `vkUserId`), действия водителя (принять/отклонить) — `ButtonGroup` (только pending).
- Устаревший `<Div>` заменён на `<Box>` (ReviewCard, панели Privacy/Terms); `StarPicker` — иконка-сердце + невидимая рамка кнопки; `CreateReviewModal` мигрирован на `ModalPage`.

- Maximum seats per trip reduced from 4 to 3 (`MAX_SEATS` in shared contracts): at most 2 passengers on the rear seat for comfort. Applies to trip create/edit validation, booking seat validation, and the seat picker. The create/edit forms show a hint under the seats field: «Не более 3 мест: на заднем сидении — только 2 пассажира, для комфорта». Seed data and tests updated accordingly.
- Trip creation/edit forms take travel time in whole hours («Время в пути, часов»: 3, 4, 5…) instead of minutes; the value is converted to `durationMinutes` (×60) at the form boundary. Storage, API contract, and overlap checks are unchanged.
- Seed durations are whole hours (120–540 min) to match what the hours-based form produces; re-running the seed refreshes all departure dates relative to now.

### Fixed

- После удаления профиля показывалась «Ошибка авторизации», а ретрай зацикливался: `clearSession` уводил в `unauthenticated`, повторный `/auth/vk` отвечает удалённому аккаунту 403 — и снова ошибка. Новый терминальный статус `deleted` + экран «Профиль удалён» без кнопки повтора (маппинг 403 по `message: "Account is deleted"`, т.к. `code: FORBIDDEN` совпадает с баном — проверка раньше `isBannedError`); `DELETE` сразу выставляет `deleted` (`markAccountDeleted`), фоновые переходы и stray-обновления токенов его не сбрасывают. Tests: store (+3: маппинг deleted, markAccountDeleted, фон), `AuthGate` (+1 экран без ретрая).

- Удаление профиля блокировалось историей: `DELETE /users/me` считал «активной бронью» любую pending/confirmed на поездке со статусом != cancelled — включая завершённые поездки, после чего удаление было невозможно никогда. Теперь учитываются только брони на активных поездках (`trip.status = "active"`). Tests: `profile-deletion.test.ts` (+2: блок на активной, пропуск истории).
- Удаление профиля молча не работало на Android: промис `ConfirmProvider.confirm` висел на событии конца анимации закрытия — VKUI без `autoCloseDisabled` откладывает action до `onExited` (*animationend*), а в тамошнем WebView это событие не приходит (в логах бэкенда — ноль `DELETE /users/me`; в десктопном Chromium всё открывалось). Провайдер переписан: очередь через `chainConfirmTask` (`helpers/confirmQueue.ts`) + обеим кнопкам `autoCloseDisabled` (action выполняется синхронно в тапе) с мгновенным анмаунтом; оверлей/Esc/крестик резолвят `false` через `onClose` (кроме `click-item`), `onClosed` — safety net. Проверено в браузере при полностью убитых анимациях (`animation:none`, reduced motion, mobile): оба диалога → `DELETE` уходит. Tests: `confirmQueue.test.ts` (3: порядок, блокировка второго, живучесть цепочки).
- `City.nameNormalized`: добавлен `@unique` в Prisma-схему (SQL-миграция уже создавала уникальный индекс `City_nameNormalized_key`, но атрибут в схеме отсутствовал — `prisma validate`/CI ловил дрейф).
- e2e `full-cycle.mjs`: навигация по месяцам в календаре, перезагрузка отзывов и селектор push-уведомлений; поток теперь 15 шагов (15-й покрывает блок «Push-уведомления VK» в `/profile/notifications`).
- Убран мёртвый код `dto.fromCity`/`toCity` из `importantFieldsChanged` в `backend/src/trips` (маршрут в PATCH заблокирован — см. City Picker).

#### VK Profile Sync On Login

- Users are no longer stuck with the «Пользователь VK <id>» placeholder and default avatar: the mini-app now fetches the profile via VK Bridge `VKWebAppGetUserInfo` (with a 3s timeout) and sends `firstName`/`lastName`/`photo` with the `/auth/vk` payload (fields restored to `authRequestSchema`); the backend saves them as display data. VK launch params (`first_name`/`last_name`/`photo`) are kept as a per-field fallback. Avatars are accepted only over https from VK CDN hosts (`*.userapi.com`, `*.vk.com`, `*.vk.ru`, ...) — arbitrary URLs are rejected. The avatar re-syncs from VK on every login (it is not editable via API); the name replaces only the placeholder, so names edited via `PATCH /users/me` are never overwritten. Existing placeholder users pick up their VK name on next login. The fields are unsigned (VK signs only `vk_*` params) and remain display-only — identity and `isVerified` still come from the signed `vk_user_id`.

#### Search Filters Accordion

- «Выбор даты» in trip search is now a VKUI `Accordion` (collapsed by default) instead of a toggle button; date filters live in `Accordion.Content` and expand with the summary chevron.

#### Trip Tags Section Insets

- «Особенности поездки» in trip details renders tag badges directly in the Group without a card frame (16px padding — explicit pixel values that do not depend on VKUI theme tokens).

#### Booking Status Text Duplication

- Passenger booking status in trip details no longer duplicates the confirmation wording: the parenthetical status was removed from the `FormStatus` title («Заявка на место No3 отправлена», «Место No3 забронировано»), the status is conveyed by the body text only («Ожидайте подтверждения от водителя.», «Водитель подтвердил вашу бронь. Приятной поездки!»).

#### Russian Pluralization And Empty Requests Section

- Profile modal: «22 поездок» → «22 поездки» — trip count now uses a shared `pluralRu` helper (1 поездка / 2 поездки / 5 поездок); the duplicated local `pluralSeats` helpers in TripCard and TripsManagePanel were deduplicated onto it.
- Trip details: the «Управление заявками (0)» section no longer renders when there is nothing to manage. With only confirmed passengers the group is titled «Подтвержденные пассажиры (N)»; with no bookings at all the section is omitted entirely.

#### Passenger Profile Modal

- Drivers can now open a passenger's profile (info + reviews) from trip details and the trip requests panel: the confirmed-passenger row is fully clickable, and request rows have a clickable avatar. The shared profile modal takes an optional role title («Профиль пассажира»); previously only the driver's profile was reachable.

#### Driver Booking Requests Order

- In trip details, pending booking requests now render directly under «Управление заявками» instead of below the «Подтвержденные пассажиры» block — requests require driver action and come first. The confirmed-passengers subsection title now uses the same VKUI `Header` as the group title (consistent typography and insets).

#### CI: Backend Bookings Pagination Tests

- `bookings-pagination.test.ts` created bookings with `seat: (i % 4) + 1`; after the MAX_SEATS=3 change the fail-closed response validation rejected seat 4 with 500. Seats now cycle 1..3.
- Backend vitest now aliases `@edem/contracts` to the TypeScript source instead of the built `dist`: a stale contracts build silently validated responses against the old schema and masked the failure locally while CI (fresh build) caught it.

#### Terms And Privacy Panels Full-Bleed Text

- «Пользовательское соглашение» and «Политика конфиденциальности» paragraphs no longer touch the screen edges on phones: VKUI `Paragraph` has no intrinsic padding and `Group modeNone` adds none at small view widths. All paragraphs are wrapped in `Div`, aligning text with the section headers' 16px inset.

#### Home Banner Full-Bleed On Phones

- The «Едьте дешевле поезда» / «Едете куда-то за рулём?» banners no longer stretch edge-to-edge on phones: VKUI `Group modeNone` resolves `--vkui_internal--Group_card_mode_padding_size` to 0 at small view widths (the card padding rule only applies from small tablet up), so the banner lost horizontal insets. Both banners are now wrapped in `Box padding="system"`, matching the neighboring search block.

#### Driver Profile Modal Overflow

- Review rows no longer overflow the modal horizontally: `Accordion.Summary` (built on VKUI `SimpleCell`, `white-space: nowrap` by default) rendered the «Маршрут · дата» subtitle as one unbreakable line, pushing the row past the card edge and clipping the star rating in the `after` slot. `multiline` is now set so the subtitle wraps.

#### Trip Address Visibility (`GET /trips/:id`)

- Trip details no longer mask exact meeting addresses for trip participants: the driver and users with an active booking (pending/confirmed) now receive real `fromAddress`/`toAddress`. Previously the endpoint masked for everyone, so drivers saw their own departure point duplicated as «Москва / Москва» in trip details.
- Public masking now omits the address fields entirely instead of substituting the city into them, eliminating fake duplication on public search cards.
- `fromAddress`/`toAddress` are optional in the shared `tripSchema`; `RouteLine` already rendered missing addresses correctly.
- New integration suite `trip-address-visibility.test.ts` covers driver, stranger, pending/confirmed/cancelled booking visibility, and the public list.

### Bugfix Remediation (2026-08-27)

All 21 findings from the full logic-bug review are resolved: 7 Medium, 14 Low. Plus one same-class follow-up (review text whitespace). New regression coverage: 18 backend integration tests (`ban-enforcement.test.ts` — 5, `admin-moderation.test.ts` — 11, `trips-search-departed.test.ts` — 2) and 12 contract tests.

#### Security: Ban Enforcement

- Ban is now enforced on every auth path, not just `requireAuth`: `/auth/refresh` checks `bannedAt` before issuing tokens (banned → all active refresh tokens revoked + `403`), WebSocket authentication performs a DB lookup and closes banned connections with code `4403`, and `optionalAuth` treats banned users as guests (no user attached, so banned users no longer see private trip addresses via `GET /trips/:id`).
- Admin ban (`PATCH /admin/users/:id/ban`) now immediately closes all open WebSocket connections of the banned user (`4403`).
- `requireAuth` no longer masks database outages as `401`: the try/catch now covers only JWT verification; DB lookup failures propagate to the global handler as `500`, so clients no longer drop valid sessions during a DB outage.
- Refresh-token reuse detection is hardened: token-family revocation runs in its own try/catch — a revocation failure still returns `401` and the security event is always logged.

#### API And Contracts

- Admin trip cancel (`PATCH /admin/trips/:id/cancel`) is guarded by status: completed and cancelled trips are rejected with `409 TRIP_NOT_ACTIVE` (previously a completed trip could be flipped to cancelled, stripping passengers of review eligibility while keeping `tripsCount`).
- Admin booking status change (`PATCH /admin/bookings/:id/status`) now keeps seat accounting consistent: moving an active booking to `declined`/`cancelled` restores `seatsAvailable`, reactivating a booking re-holds a seat (409 if none free or the seat is taken), and unique-index conflicts (`P2002`) return `409` (`SEAT_TAKEN`/`ALREADY_BOOKED`/`BOOKING_CONFLICT`) instead of `500`. Runs in a Serializable transaction like the driver endpoint.
- Admin review delete (`DELETE /admin/reviews/:id`) recomputes the target user's `rating`/`reviewsCount` in the same transaction (shared `recomputeUserRating` helper, also used by review creation) — deleted reviews no longer count in the rating forever.
- Trip search (`GET /trips`) no longer returns already-departed trips (they stayed listed up to 24h until the auto-completion worker ran, sorted first, and every booking attempt failed with `TRIP_IN_PAST`). `GET /trips/my` is unchanged so drivers can still complete departed trips.
- Trip edit (`PATCH /trips/:id`) rejects already-departed trips with `409 TRIP_IN_PAST`, matching the departure cutoff of booking creation/cancel and driver decisions.
- Changing a trip's departure time/duration now also checks passengers' other active bookings for overlap and rejects with `409 PASSENGER_BOOKING_OVERLAP` (same overlap semantics as booking creation) — passengers can no longer end up with two active bookings on overlapping trips.
- Manual trip completion (`PATCH /trips/:id/complete`) now notifies declined pending passengers (persistent notification + WS events), matching the auto-completion worker path.
- Seat limits are uniform: input DTOs and response schemas both cap at `MAX_SEATS = 3` (no legacy tolerance — the app is in development with no production data, so the four-seat rows the earlier migration preserved cannot occur).
- Production SPA fallback no longer swallows unknown API routes: the `index.html` catch-all excludes the `/api` prefix, so mistyped/removed API GETs return a JSON `404` instead of `200 text/html`.
- Contracts reject whitespace-only user text: `createFeedbackDtoSchema.subject/text` and `createReviewDtoSchema.text` now trim before the min-length check (Zod 4 `.trim()`), so `"   "` no longer passes validation to be persisted as an empty string.

#### Mini-app

- Drivers can review all confirmed passengers: the review-trip modal filtered a trip out after ANY review on it, hiding remaining unreviewed passengers; the filter is now per target (`tripId:target`), matching the backend's `GET /reviews/available-trips` logic.
- Trip search auto-loading stops on error: the "load more" effect and IntersectionObserver now check `isError` (sentinel unmounts, matching TripsManagePanel), eliminating an unbounded `fetchNextPage` retry loop when next-page requests fail.
- Edit-trip no longer silently mutates duration: exact `durationMinutes` is preserved on save unless the duration field was actually changed (a 90-minute trip no longer becomes 120 minutes).
- Edit-trip drafts are written to localStorage only after the first user change instead of on mount, so stale snapshots can no longer shadow newer trip data on reopen.

#### Webapp (Admin Panel)

- All admin tables format dates in the service timezone `Europe/Moscow` (shared `webapp/src/lib/format.ts` helpers), matching the backend display convention — previously timestamps rendered in the admin's browser timezone and late-evening departures could flip to the wrong calendar date.
- Users page resets pagination synchronously with the search input (Bookings/Trips pattern) instead of a post-render effect, eliminating a redundant request with the stale page on every search change.

### Audit Remediation (2026-08-21)

All findings from the full source audit are resolved: 2 High, 7 Medium, 26 Low.

#### Security

- Refresh-token rotation is atomic: revocation is a single `UPDATE ... WHERE revokedAt IS NULL` claim, so concurrent rotations of one token can no longer both succeed (TOCTOU race under Read Committed).
- Refresh-token reuse detection: presenting an already-rotated token to `/auth/refresh` revokes ALL active tokens of that user (token family revocation). A repeated `/logout` with an old token does not revoke the family.
- Auth rate limits are configurable per endpoint: `VK_AUTH_RATE_WINDOW_MS`/`VK_AUTH_RATE_MAX` (default 5 req/5 min) and `REFRESH_RATE_WINDOW_MS`/`REFRESH_RATE_MAX` (default 10 req/10 min). The previously dead `AUTH_RATE_*` variables were removed.
- Production Compose publishes the backend on `127.0.0.1:3000` only; the local dev database binds to `127.0.0.1:5433`.

#### API And Contracts

- `GET /trips` rejects non-positive `maxPrice` with `400` (contract requires a positive integer).
- `PATCH /bookings/:id/status` maps unique-index conflicts (`P2002`) to `409`, matching `POST /bookings`.
- WebSocket contract matches the implementation: server sends `auth:ok`, `ping` (keep-alive), and business events; client sends only `auth` and `pong`. Dead server `pong`/`error` events, unused `wsPingSchema`, and a client `ping` variant were removed.
- `authRequestSchema` accepts only `searchParams`; dead `vkUserId`/`sign`/`ts` fields were removed.
- `tripFiltersDtoSchema` includes `q`; the frontend search filters type is now the shared contract.

#### Frontend

- Trip details invalidates `trip.id` cache keys after driver booking decisions and passenger cancellation.
- Edit-trip form computes next values outside the state updater (StrictMode-safe).
- Departure-time pickers rely on Moscow-time validation instead of device-timezone `disablePast`.
- Query retry policy retries request timeouts (408) and never retries deterministic response-validation failures.
- The HTTP client honors caller signals that are already aborted before dispatch.
- Snackbar dedupe map evicts expired entries; WS events invalidate public trip lists; corrupted localStorage drafts are discarded via shape validation; all path-interpolated API ids are URL-encoded.

#### Tooling And Deploy

- Unused root dependencies removed (`@google/genai`, `express`, `lucide-react`, `motion`, `react-router-dom`, `@types/express`); `vite` declared once (devDependencies).
- `npm run clean` removes actual workspace build outputs.
- Docker image runs `node:22-alpine`, matching CI Node 22; `engines` requires Node >= 22.
- Stale `bun.lock` removed and gitignored; npm/`package-lock.json` is canonical.
- Graceful shutdown closes idle keep-alive connections; access log and request metrics include errored requests.
- Prisma schema drops the explicit review-unique index name, eliminating schema/migration drift.
- `metadata.json` identity fields filled; bogus Gemini capability removed.

### Security And Integrity Hardening

- VK authentication verifies the complete signed launch parameter string and does not trust unsigned profile fields or derive `isVerified` from browser input.
- Public profiles omit license plates; public trip responses mask exact pickup and destination addresses.
- VK community messages use `POST /messages.send`; the community token is not placed in the request URL.
- Driver booking decisions are rate-limited and restricted to `pending -> confirmed|declined` before departure. No-op decisions do not create duplicate notifications.
- Review authorization is directional: passenger -> driver or driver -> confirmed passenger.
- Trip auto-completion atomically claims active trips, and seat resizing revalidates occupied seat numbers inside the serializable transaction.
- Notification cursors validate UUID/date payloads and reject invalid fractional limits.
- Frontend API response validation fails closed on schema drift; login and refresh responses use `authResponseSchema`.
- WebSocket cleanup prevents reconnects after unmount and ignores stale socket callbacks. VK visibility and swipe-back lifecycle handling is synchronized and cleaned up.

### API And Database

- `POST /bookings` returns `200` for an idempotent retry by the same passenger and seat, `409 SEAT_TAKEN` for another passenger, and `409 ALREADY_BOOKED` for another seat held by the same passenger.
- Partial unique indexes `active_seat_booking` and `active_passenger_booking` protect active bookings from races.
- `GET /reviews/user/:userId` and `GET /bookings/trip/:tripId` use cursor pagination with `limit` and `cursor` validation.
- Legacy trips are normalized to the four-seat maximum; active out-of-range bookings are declined during migration.
- Trip worker processing is batched with keyset pagination and atomic active-trip claiming.

### Historical Notes

- API robustness includes idempotent booking retries, partial unique booking indexes, and Serializable conflict handling.
- Cursor-based pagination is used for public user reviews and driver booking requests.
- Trip worker processing uses bounded batches, keyset pagination, selective reads, and `Promise.allSettled` for side effects.
- Sentry helpers strip PII, VK launch timestamp drift is observable, and the WebSocket reaper has idempotent shutdown and zombie-tick protection.
- CI checks contracts, Prisma validation, typechecking, build, tests, and untracked build artifacts.

### Observability And Tooling

- Sentry initialization is centralized with PII stripping for users, request data, and sensitive extra fields.
- VK launch timestamp drift over one minute is logged and reported for diagnostics; timestamps older than five minutes are rejected.
- WebSocket reaper shutdown is idempotent and ignores queued zombie ticks.
- CI verifies contracts, Prisma, typechecking, build, tests, and that build artifacts are not tracked.

### Verification

- `npm run typecheck` passed for all workspaces.
- 164 tests passed: 34 frontend, 28 contracts, 102 backend (including the new refresh-rotation integration suite).
- `npm run lint`, `npm run format:check`, and `npm run bundle:check` passed.
- `npm run build` passed; the Docker image builds on `node:22-alpine`.

### Breaking Changes

- `POST /bookings` idempotent retries now return `200` with the existing booking instead of `409`.
- `GET /reviews/user/:userId` and `GET /bookings/trip/:tripId` return `{ items, pagination }` instead of a bare array.
