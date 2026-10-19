# telegram-app — MEMORY

> Onboarding memory for the next agent. Goal: read this file and immediately
> understand the structure, invariants, conventions and pitfalls of `telegram-app/`
> without rediscovering the codebase.
>
> Complements, does not replace: the root `README.md`, `src/ui/README.md`.
> Source of truth for kit props is the installed
> `node_modules/@telegram-apps/telegram-ui/dist/**/*.d.ts` (not the docs, not training data).

**Status (2026-10-19):** telegram-app **199 files / 1653 tests**, green; the rest of the
workspaces — `npm run test` (contracts + backend + telegram-app + webapp). e2e-parity —
**17 steps** (`e2e/telegram-parity.mjs`), contrast — `e2e/ui-contrast.mjs`. The registry
of deviations from the kit is `src/ui/README.md` (#1–#59): **read it before changing
UI/forms**.

---

## 1. What this is

`telegram-app/` is the Telegram Mini App (TWA) of the ride-sharing service "Edem" («Едем»).
A separate workspace of the root monorepo `edem` (npm workspaces: `telegram-app`,
`backend`, `webapp`, `packages/*`).

The app opens inside the Telegram WebView: fullscreen, its own scroll,
the native chrome is drawn by the client. This dictates everything: HashRouter, safe areas,
no PWA, `base: './'`.

## 2. Stack and pins

| Layer | Package | Version | Note |
|---|---|---|---|
| UI kit | `@telegram-apps/telegram-ui` | **2.1.13 (pin)** | check props only against `dist/**/*.d.ts`; the version is pinned by the test `src/__tests__/kitContract.test.tsx` |
| Telegram SDK | `@tma.js/sdk-react` | **3.0.23 (pin)** | the `@tma.js/*` scope is historical (renamed to `@telegram-apps/sdk-react`); code and tests uniformly sit on `@tma.js@3.0.23`; migrating is separate work, not a defect (see §17) |
| Framework | React | 19.0.1 | `StrictMode` (double-mount is accounted for everywhere) |
| Router | react-router-dom | 7.x | **HashRouter** — mandatory for WebView/deep links |
| Build | Vite | 8.2 (Rolldown) | root devDependency; `codeSplitting.groups` instead of `manualChunks`; `base: './'` |
| TS | typescript | 5.8 | root devDependency; `strict` + `noUncheckedIndexedAccess` + `isolatedModules` |
| Server state | `@tanstack/react-query` | 5.102 | one `QueryClient` in `AppConfig.tsx` |
| Client state | `zustand` | 5.x | only `useAuthStore` (and small ones) |
| Validation | `zod` | 4.5 | API and WS responses via `@edem/contracts` |
| Icons | `lucide-react` | 1.44 | sizes 28/30px, `strokeWidth={2}` |
| Tests | `vitest` 4.1 + `@testing-library/react` + `jsdom` | | **no setup file** — mock config per-file |
| Runtime | Node | 22 | `engines: ">=22"`, `npm ci` by `package-lock.json` |
| Tailwind | — | | **not used**; only tgui + CSS modules |

## 3. Commands

```bash
# from the repo root
npm run dev                       # build:contracts + db:generate + backend:3011 + tg:3012
npm run dev:tg                    # telegram-app only (Vite :3012)
npm run build:tg                  # production build of telegram-app
npm run typecheck --workspace=telegram-app
npm run test --workspace=telegram-app   # vitest run: 199 files / 1653 tests
npm run test                            # all workspaces (--workspaces --if-present)
npm run lint:eslint:tg-app
npm run bundle:check              # bundle budget (scripts/check-bundle.mjs)
npm run token:check               # forbids literal colors/paddings (scripts/token-lint.mjs)
npm run format:check
```

Backend by default `http://127.0.0.1:3011`, Vite proxies `/api` → `VITE_API_TARGET`.
Production API — `VITE_API_URL` (if not same-origin). Allowed Host hosts — `VITE_ALLOWED_HOSTS` (comma-separated).

## 4. Boot lifecycle (INVARIANT, do not break)

`main.tsx:24-45` → `App.tsx:7-13`:

```
retrieveLaunchParams → await init() → render(<App/>) → post-mount useEffect → signalAppReady()
```

- `signalAppReady()` (`miniApp.ready`) lives **only** in the post-mount `useEffect` in `App.tsx`.
  Moving it to `await init()` would hide Telegram's skeleton over an empty WebView.
- `init()` (`init.ts`) order: `setDebug` → `initSDK` → macOS mocks → mount
  (`backButton`, `settingsButton`, `closingBehavior`, `swipeBehavior`+`disableVertical`,
  `initData.restore`) → `themeParams.mount`+`bindCssVars` → `miniApp.mount` →
  `viewport.mount`+`bindCssVars`+`expand`.
- `viewport.mount` is the only `BetterPromise` (await); the other mounts are synchronous.
- A failure of `retrieveLaunchParams`/`init` → render `EnvUnsupported` (not in Telegram).
- `swipeBehavior.disableVertical()` — global: otherwise a swipe down collapses the app.

## 5. Dev outside Telegram

`mockEnv.ts` (only `import.meta.env.DEV`, tree-shaken in production):
- `isTMA("complete")` — if not a TMA, `mockTelegramEnv` is installed with theme/viewport/
  safe-area/fullscreen answers and a fake initData (`hash: "dev-hash"`, user id 9800001).
- `markTelegramMockEnv()` sets the window flag `__TG_ENV_MOCKED__`; the UI, via
  `isTelegramMockEnv()` (`utils/telegram-adapter.ts`), skips native dialogs
  (the mock does not draw `popup.show`, although `isAvailable()` lies `true`).
- `dev-hash` is accepted by the backend only with `ALLOW_DEV_AUTH` (see backend
  `src/auth/telegramSign.ts`). In production outside Telegram — `EnvUnsupported`.
- Mobile dev requires HTTPS with a valid certificate (tunnel); self-signed/mkcert
  breaks on iOS/Android.

## 6. Layering and import rules (enforced by ESLint)

`eslint.config.mjs`:
- Pages/components import **`@/ui/*`**, not tgui directly.
- `no-restricted-imports` forbids importing the kit names directly:
  `Button`, `IconButton`, `Card`, `List`, `Cell`, `Section`, `SegmentedControl`
  (all of them have wrappers; `Page` replaces `List`, `Switcher` replaces
  `SegmentedControl`). `Cell` — together with the facade `ui/Cell`, `Section` —
  together with `ui/Section`, `SegmentedControl` — together with `ui/Switcher`. Layout
  primitives (`Divider`, `Text`, `Caption`, `Title`, `Headline`, `Avatar`, `Skeleton`,
  `Spinner`, `Input`, `Textarea`, `Select`, `Modal` (inside Sheet), `Snackbar`,
  `TabsList`, `Placeholder`) are imported from the kit **directly** (deliberately, see
  `src/ui/README.md`).
- `src/ui/**` does not import `@/pages|components|queries|store|providers`
  (bottom of the layering: only the kit, `@/ui/*`, `@/hooks/*`, `@/utils/*`).
- `react-hooks` + `jsx-a11y` recommended for `telegram-app/src/**`.
- type-aware rules are not enabled yet (noisy/slow on tgui types).

## 7. UI facade `src/ui/` — the main knowledge

The full registry of deviations — `src/ui/README.md`. In brief:

- Cascade: tgui is included as `@import ... layer(tgui)` (`index.css:7-8`).
  The app's non-layered CSS modules **always** beat the layered kit — `!important` is not needed,
  specificity doesn't matter. Pinned by the test `src/__tests__/layoutCss.test.ts`.
- **Selector doubling (`.X.X`) raises specificity** (0,2,0 versus
  0,1,0) and matches an element with ONE occurrence of the class — verified in the browser
  (`el.matches('.a.a') === true` for `class="a"`). This is a technique, not a mistake: the
  repository has 39 such working rules. Against the kit it is not needed (the
  layer decides), justified only against a same-named consumer rule.
  **Do not "fix" `.X.X` → `.X`: I did that in 23 places and rolled it back — it
  lowered specificity for no reason.**
- **The same class of defect:** `Field` did not add its own
  class to the wrapper if the consumer didn't ask for one — and the shared rule for the field
  label tone would have been dead. Same with the kit: `className` on
  `Select` lands on the inner `<label>`, and the coloring works only
  because the kit's `select` = `background: inherit`. **A facade
  component must always carry its own class** — pinned in
  `src/__tests__/cssClassReach.test.ts`.
- **Finding:** `ui/Card` did not add `styles.card` to
  `className` (only `cardDefault`/`cardFlush`), so `.card.card` matched
  nothing — cards rendered with kit defaults: radius 20 and
  the literal background `tertiary_bg_color` (`rgb(42,42,42)`) instead of the Telegram theme.
  Pins: the class in the DOM — `src/ui/__tests__/card.test.tsx`; "class does not apply"
  — `src/__tests__/cssClassReach.test.ts`; cascade in the browser —
  `e2e/ui-cascade.mjs`. Write-up — `src/ui/README.md`, "A rule that does not
  apply".
- **The `ui/` facade is 22 components.** Kit wrappers (the facade holds the look):
  `Page`←`List`, `Button`, `IconButton`, `Chip`, `Card`, `Sheet`←`Modal`,
  `Field`+`FieldError`←`Input`/`Textarea`/`Select`, `EmptyState`←`Placeholder`,
  `Loading`←`Spinner`+`Placeholder`, `FetchMore`←`Button`, `Cell`,
  `Section`+`SectionBody`, `Switcher`←`SegmentedControl`/`Chip` ("one of N"
  switch, `radiogroup`/`tabs` semantics inside the facade), `MenuRow`,
  `SwitchRow`. Own markup on tokens: `Notice`, `Stack`, `Blockquote`,
  `CharCounter`, `GroupLabel`.
  ESLint forbids importing the kit directly for `Button`, `IconButton`, `Card`,
  `Cell`, `Section`, `List`, `SegmentedControl`.
- **`ui/Cell`.** An interactive row must be a native
  button: `Component="button"` is the kit's documented way (Cell.d.ts)
  and the only path with focus, Enter/Space and a button role. The kit does **not** reset
  the UA button styles (Arial 13.33px, black color,
  `appearance:auto`, `box-sizing` border-box versus content-box, width
  356 versus 404) — the reset lives in `ui/buttonReset.module.css` (`AS_BUTTON`),
  identical for both roots. Pin: `src/ui/__tests__/cell.test.tsx`.
- **`Chip` and `Accordion.Summary` with `Component="button"`** (4 + 2 places) leak
  the same way, so `ui/Chip` carries `AS_BUTTON`, and `Accordion.Summary`
  receives the constant explicitly.

## 8. Theme and safe-area (the least obvious)

- `AppConfig.tsx`:
  - `useTguiPlatform()` — iOS→`ios`, everything else→`base`; the dev platform override
    (`utils/devPlatform`, `DevToggles`) takes precedence over the client.
  - `useTelegramAppearance()` — a dual theme: the `miniApp.isDark` signal + a manual
    override (light/dark Telegram palettes inline). `AppRoot appearance` +
    the `dark` class on `<html>` for `--app-*`. `--tg-theme-*` are bound by the SDK **inline
    once** — on override they are re-set manually.
  - `setHeaderColor(bgHex)` — **hex, not keyword**: a keyword on iOS fullscreen gives an
    invisible status bar/pills; hex chooses `.Black/.White` by lightness.
  - `useFullscreenSubscription()` — Bot API 8.0, request on mount + retry via
    `setTimeout(50)` (viewport mounts asynchronously); `ConcurrentCallError` is swallowed.
- Safe-area (`index.css:21-99`): the aggregators `--tg-safe-area-*` =
  `max(env(safe-area-*), SDK variables, floor)`. `env()` sits next to the SDK variable in
  `max()`, **not** as a `var()` fallback (the SDK always defines the variable, even as zero).
  Scope of `env()` is **outside Telegram only**: inside the client webview
  `env(safe-area-inset-top)` is always 0, so a zero client report is the hook's job, not `env()`'s.
- iOS bug: in fullscreen the client reports `safe_area=0` on top of the rendered chrome.
  `useTelegramChromiumFallback.ts` sets the token-floor `--tg-safe-area-top-min` =
  `--tg-telegram-chromium-height` (88px, calibrated on iPhone 11 / TG 12.9.4) and "pokes" the
  client with `request('web_app_request_safe_area'|'...content...')`. Change 88px only
  in sync in `index.css` and the hook's `DEFAULT_THRESHOLD_PX`.
- `Tabbar`/`FixedLayout bottom` pad only `env(safe-area-inset-bottom)` (=0 in TG iOS) —
  compensated by the `max(...)` token.
- Viewport meta (`index.html`): `viewport-fit=cover, interactive-widget=resizes-content`.
  `cover` is required for `env()`/safe-area; `resizes-content` keeps the bottom of forms
  above the on-screen keyboard in the Android WebView (iOS ignores the hint).

## 9. Auth and session

- Entry: `AuthGate.tsx` → `useAuthStore.bootstrap()` (`store/useAuthStore.ts:172`) →
  `getRawInitData()` (raw string, **without re-sorting**, otherwise the HMAC won't match) →
  `POST /api/v1/auth/telegram { initData }`. Identity is verified by the backend HMAC
  (`@telegram-apps/init-data-node`); client data is not taken on faith.
- `AuthStatus`: `idle | initializing | authenticated | unauthenticated | error |
  background | banned | deleted`. **`error` is never set** (everywhere
  `unauthenticated`) — unreachable branches `AuthGate.tsx:73,179` (see Findings).
- **Transition to ban — only via `markBanned()`** (`e46039c`). A direct
  `setState({status:"banned"…})` no longer occurs anywhere: such a path
  forgot `initData`, and the appeal goes **without a token** and is confirmed by that
  string — the form failed without sending the request. `purgeLaunchParamsCache` is not
  called on ban (a ban is not a logout). Plus the `getRawInitData()` fallback in
  `submitSupportFeedback` — for the branch "403 on /feedback, session status
  still `authenticated`" (`SupportPage`), which doesn't enter the store.
- 403 `FORBIDDEN` → ban (`banReason`, screen + appeal form via the public
  `POST /feedback/appeal` with raw initData). 403 `ACCOUNT_DELETED` → "Profile
  deleted". Check deletion **before** the ban. Distinction is **by code**, not by
  text: the separate code `ACCOUNT_DELETED` and the predicate `isAccountDeletedError`
  live in the **contracts** (`@edem/contracts`, `schemas/api-error.schema.ts`) —
  both the backend and the client take them, so they cannot diverge. The fallback to the text
  `Account is deleted` is for the old backend that doesn't have the code yet.
- 429 → 60s cooldown in `AuthGate` (repeated taps extend the rate-limit window).
- Background: `visibilitychange` → `handleBackgroundState`; on return, refresh if expired.
- `clearSession`/`markAccountDeleted` purge the SDK's launch params cache
  (`purgeLaunchParamsCache`: keys `nlaunchParams` and `tapps/launchParams`) —
  otherwise the raw initData survives logout in sessionStorage.

## 10. API client (`api/client.ts`)

- `apiClient` is a singleton. All responses are parsed with a Zod schema from `@edem/contracts`;
  invalid → `ApiError("Invalid server response", "INVALID_RESPONSE", 502)`.
- Timeout 15s (both in `doFetch` and in refresh), correct propagation of cancellation of an external `signal`
  (including one already aborted before start).
- `ApiError`: `code`, `status`, `retryAfterMs`, `banReason` (PII, not logged).
- **Single-flight refresh** `tryRefresh()`: one request for N parallel 401s;
  `refreshGeneration` invalidates applying the result after logout
  (`invalidatePendingRefresh`). 400/401/403 → `permanent-rejection` (403 `FORBIDDEN` →
  `emitBanned`/`emitDeleted` + `emitSessionExpired`); anything else → `transient-failure`
  (the session is not torn down).
- Events (subscriptions in `AuthGate`/`useAuthStore`/`WsProvider`): `tokenUpdate`,
  `sessionExpired`, `banned`, `deleted`, `refreshStart`, `refreshEnd`.
- QueryClient retries (`AppConfig.tsx:29-58`): 4xx (except 408) and `INVALID_RESPONSE` — no
  retry; network/5xx — up to 3; `staleTime 60s`; `refetchOnWindowFocus:false`; mutations — 0 retries.

## 11. Realtime (ws.v1)

The ws.v1 contract was removed from the tree — see git (formerly
`docs/migration/telegram-realtime-contract.md`); schemas — `@edem/contracts`
(`wsServerEventSchema`/`wsClientMessageSchema`). Transport policy — `src/api/ws.ts`.

- The socket opens only when `status==="authenticated"`. The JWT — **as the first message**
  `{"type":"auth","token"}`, **never** in the URL/query (leak into logs).
- Server `ping` → client `pong`. There is no client ping/subscription.
- Reconnect: bounded backoff 1s→30s, jitter 0.75..1.25 (`computeReconnectDelay`).
- Close policies (`classifyWsClose`): `4403` terminal (no refresh loop),
  `1008/4401` auth-refresh (via `apiClient.tryRefresh`), `1000` stop, the rest —
  reconnect. Inside 4403 the reason (`CloseEvent.reason`) decides whether the account was **deleted**
  or **banned** — the screens differ; the backend strings are listed in §18.
- Reconnect pause in background/offline, resume on `visibilitychange`/`online`.
- Resync after every reconnect (`resyncSeq > 0`) — invalidation of
  `TRIP_KEYS.all`/`BOOKING_KEYS.all`/`NOTIFICATION_KEYS.all` (HTTP refetch, not replay).
- Event dedup: the module-level set `realtimeSeenEvents` (lives across mounts and
  across tests of one file — **keys in tests are unique**), cap 200.
- `notification:new` is only a hint, no toast. The hint is **narrowed**: it invalidates
  `NOTIFICATION_KEYS.unreadCount()` + `NOTIFICATION_KEYS.lists()` (the current list),
  NOT a blanket `all`. The others (`booking:*`, `trip:*`) — invalidation + Snackbar + haptic.
- **A settings row = `Cell` + a switch in `after`, without its own borders.**
  Two traps:
  1) `width: 100%` + `padding` + `border` with `box-sizing: content-box` produce
     overflow: the profile had **382px against the parent's 356px**, running off the
     right edge. The defect was masked by `box-sizing` in some modules and
     the absence of padding in others.
  2) `Section` inserts a `Divider` only between **direct** children
     (`Children.map` + `Divider` in Section.js). A `Stack` wrapper hides the rows
     from the kit: there will be no dividers, use your own `gap` instead.
  A switch row is not clickable as a whole: a native `Switch` inside
  `<button>` is invalid nesting and a double trigger on Enter/Space.
   An extra action inside the section, if needed, goes in the `footer` slot: as a separate
   child the row divider would have separated it. There is no button to reset the theme to
   "As in Telegram": `themeOverride` lives in localStorage,
   the switch sets only light/dark, so returning to
   "as in Telegram" from the UI is impossible. The way
   back, if needed: a 3-state cycle (auto → light → dark → auto).
   Pin: `pages/Profile/__tests__/switchRow.test.ts`.
- **The transport is split: `WebSocketProvider.tsx` = 562 lines + `TelegramRealtimeListener.tsx` = 258 lines.**
  Domain subscriptions have already been moved to `providers/TelegramRealtimeListener.tsx`;
  the provider keeps the transport (WsProvider) + the 4403 classifier (see §17).

## 12. Routing and deep links

- `router/AppRouter.tsx`: `HashRouter`; `Shell` holds `NavHeader`, `AppBottomBar`,
  `route-fade` (CSS, not motion/react — saves ~39 KiB), `useScrollRestore`.
- Native `backButton`: first the state modal (`handleModalBack`), then history,
  fallback to `/bookings` for `/trips/my/new`, otherwise `/`.
- `settingsButton` leads to `/profile` everywhere except the profile.
- The start `tgWebAppStartParam` is parsed once (`didHandleStartParam`):
  `resolveStartParamRoute` (`router/deepLinks.ts`) — `trip_<uuid>` → `/trips/<uuid>`,
  section tokens from `START_PARAM_ROUTES`, unknown → `FALLBACK_ROUTE` (`/trips`).
  Raw user data **must not** go in startapp; per-entity ids go through
  `Notification.deepLink`.
- The tab is determined by `location.pathname`; titles — `HEADER_TITLE_RULES` at module
  level (not recreated).
- **The settings button is where there is no "back" button and there is a tab bar, i.e. on
   root routes** (`useSettingsButton(openProfile, isRoot && pathname !== "/profile")`).
   `/profile` is excluded separately: a tap would lead to the same screen. Non-root
   routes are either a subtree of the profile (the transition would lead to the parent), or
   a focused scenario with a return. The native Telegram button
   cannot be measured outside the client — this is unverifiable.
- `route-fade` key = only `pathname` (a query change does not remount the page, so as not to
  lose scroll/skeletons).

## 13. Query keys and notifications

### Query keys

`queries/useTripsQuery.ts`: `TRIP_KEYS = { all, lists(), list(filters), my(),
details(), detail(id) }`. Likewise `BOOKING_KEYS`, `NOTIFICATION_KEYS`.
`NOTIFICATION_KEYS = { all, lists(), inbox(limit, segment), unreadCount() }`.
The cycle is avoided by the raw `["bookings"]` in `useInvalidateTripsAndBookings`
(`useBookingsQuery` imports `TRIP_KEYS`).

`RIDE_REQUEST_KEYS = { all, trip(tripId) }` (`queries/useRideRequestsQuery.ts`).
The own-requests list is an infinite query under `[...all, "mine", "infinite"]`
(the mutation hook invalidates the whole `all` prefix). The demand feed lives
under `useRideRequestFeedQuery` — a separate key, not `all`.

### Notifications — what exists (after the 2026-10-01 plan)

- **Backend** (`backend/src/notifications/index.ts`): `GET /my` (cursor + `?role=`/`?unreadOnly=`),
  `GET /unread-count` (owner-scope, lightweight), `PATCH /:id/read` (scoped `updateMany` + 404),
  `PATCH /read-all`. Schemas — `unreadCountSchema`, `notificationsQuerySchema` in the contracts.
- **Retention**: `pruneOldNotifications` in `notification.service.ts` (outbox 30d,
  inbox read 90d / unread 180d), hook in `processExpiredTrips` (tripWorker), knobs in `env.ts`.
- **RecipientRole**: `Notification.recipientRole` (String?, migration
  `20261001092913`), `?role=` = stored role OR legacy `NOTIFICATION_ROLE_TYPES` fallback.
- **notifyUser** (`notification.service.ts`): `createNotification` + WS hint
  `notification:new` with `NOTIFICATION_HINT_REFRESH_ID` — only when a record was created.
- **Dispatcher** (`workers/notificationDispatcher.ts`): recovery of stuck `processing`
  (`TG_NOTIFICATION_PROCESSING_TIMEOUT_MS`, default 10 min), `chat_not_found`/`permanent`
  → terminal, `skipped/no_token` without a token, `trip_details_changed` among the critical ones.
- **Client**: the tab badge — `useUnreadCountQuery()`; the hint is narrowed to the counter + the current
  list; read mutations patch both caches (`applyMarkReadCaches`/`applyMarkAllReadCaches`).

## 14. Tests — conventions

- Run: `npm run test --workspace=telegram-app` (vitest run). **No setup file**:
  mocks (`vi.mock`, matchMedia, ResizeObserver, an `AppRoot` wrapper for tgui) — in each
  file as needed. For tgui components SSR `renderToString` is used, rather than
  testing the kit's internals.
- `src/__tests__/kitContract.test.tsx` — **fails when the tgui version changes**: on upgrade
  go through the deviation registry `src/ui/README.md` and update the contract.
- `src/__tests__/layoutCss.test.ts` — the cascade pin (the tgui layer is beaten by non-layered modules).
- `AppConfig.test.tsx` — contrast of the theme palettes.
- The tests `init.mockMacOS.test.ts`, `toSnakeThemeParams.test.ts` — behavior of the macOS mocks.
- **1653 tests** (199 files; 2026-10-19). SSR files (`renderToString`) do not
  see effects, so everything that lives in an effect is checked by a **DOM file
  with `@vitest-environment jsdom`**: `useScrollRestore.dom`, `useTripActions.tick`,
  `SearchPage.reset`, `tripStandardCard.a11y`, `tripCountersSection`,
  `fieldLabelTone` (the label tone is a contract, not a render),
  `sheetCloseRetention`/`targetSizes`/`blockquote`/`targetSizes.tz` (фасадные
  пины: класс в DOM, а не роль — см. §18).
- **`vi.mock` requires `vi.hoisted`.** The mock factory is hoisted above the
  variable declaration, and without `vi.hoisted` — `ReferenceError: Cannot access
  'mockX' before initialization`.
- **RTL auto-cleanup is OFF**: `globals: true` is not set, so
  `afterEach(cleanup)` must be added **manually** in every DOM file. Without it
  the unmounted tree lives until the end of the file: events reach old
   handlers, and module-level stores (the scroll cache) are corrupted for the following
   tests.
- **No jest-dom matchers** (`toBeEnabled`/`toBeDisabled` do not exist) —
  check `element.disabled` directly.
- **Contrast is computed in the browser, not in Node.** `color-mix` is not
  evaluated in Node, and the token values belong to the kit and cannot be
  copied into a test ("a token property must be single"). So vitest holds
  a **structural** pin (the tone is declared in both themes, mixes toward the required
  token, the percentage is not below the measured minimum), and the **numeric bound is in
  `e2e/ui-contrast.mjs`** (`node e2e/ui-contrast.mjs`, the same technique as
  `ui-cascade.mjs`: vitest reads the CSS text, a result is needed). Covered:
  `--app-field-label` (both themes), the `Notice` tones, `--app-muted`.
- **Three pitfalls of the contrast e2e:**
  1) **The backdrop is a composition, not the first opaque ancestor.** Overlay the
     layers onto an opaque ancestor, otherwise a false failure.
  2) **Compare colors as numbers, not strings.** The engine returns the same color
     sometimes as `rgb(...)`, sometimes as `color(srgb ...)`; string comparison yields
     0 carriers.
  3) **A selector with 0 carriers must FAIL** (`requireMin`), otherwise the step
     passes vacuously. The threshold is derived from size and weight
     (4.5 / 3:1 large), not taken from a list.
- **A check that passes without checking anything is a failure, not a success.**
  If the check found nothing (`afterEach(cleanup)` skipped,
  `requireMin` missing, the selector matched zero elements) —
  that is a test defect.
- **Before a fix, verify that the new test fails on the old code.** Otherwise
  the test pins nothing.
- **A cleanup leak is checked by ALL files, not only the new ones:**
  an unmounted tree lives until the end of the file (portals hold traps
  on `document`, timers are alive) — neighboring tests check someone else's tree.

## 15. SDK 3.0.23 gotchas (common pitfalls)

- `mockTelegramEnv.onEvent` receives an **object `{ name, params }`**, not a tuple `[method]`
  (in `@telegram-apps` 3.3.x it was different — it is easy to get a silently non-working mock).
- `themeParams.state()` and `tgWebAppThemeParams` are snake_case; `toSnakeThemeParams`
  guards against a camelCase source.
- `mount()` calls are synchronous (except `viewport.mount`); each — **exactly once**.
  Mount `themeParams` **first** (`miniApp` reads the theme on mounting).
- `bindCssVars()` — only after mounting its own component.
- `ifAvailable` is a no-op (not an exception) on an unsupported method: check availability
  explicitly via `isAvailable()` (see `shareViaTelegram`, `openTelegramUrl`).
- The static `requestSafeAreaInsets/...` were removed in 3.0.x — use `request(...)`.
- `retrieveRawInitData()` — a raw string; do not reassemble or sort it.

## 16. Skills (load via the skill tool)

Project skills live in `.opencode/skills/` (11):

| Skill | When |
|---|---|
| `a11y` | WCAG 2.2 AA audit before merge (focus, live regions, contrast, tap targets) |
| `admin-webapp` | `webapp/` conventions (React 19 + shadcn + TanStack), admin feature work |
| `backend-conventions` | Hono + Prisma 7 routes, transactions, serializers, workers |
| `contracts-dto` | shared Zod schemas/DTOs in `packages/contracts` |
| `context7` | current library docs for API/config |
| `frontend-design` | visual direction of new screens/components |
| `notifications-realtime` | inbox → outbox → WS fan-out, cache invalidation |
| `playwright-e2e` | e2e (`e2e/telegram-*.mjs`), stability, reseed-safe |
| `security-audit` | auth/dev-auth, validation, rate-limit, WS, error shape |
| `task-management` | splitting a feature into subtasks, dependencies |
| `telegram-ui` | tgui props/gotchas, rendering in the Telegram WebView |

The environment also exposes `telegram-mini-app`, `code-review-and-quality`,
`ponytail`, `prisma-client-api`, `prisma-driver-adapter-implementation`,
`tailwind-4-docs`, `tanstack-query-best-practices`, `vite`, `vitest` — load them
by name when the task matches.

Key rules from them that apply here:
- **Correctness first**: tests cover behavior, not implementation; edge/error paths.
- **Don't leave dead code**; don't breed near-duplicate helpers; don't drag feature logic
  into a shared module; watch file size (~1000 lines is a signal to decompose).
- **Auth/validation at the boundaries** — don't be lazy (an explicit exception to ponytail).
- **a11y**: icon-only → `aria-label`; async results → `aria-live`; focus after navigation;
  `prefers-reduced-motion`; tap ≥44px.
- **e2e**: no `waitForTimeout` for UI, unique data per run, cleanup in `finally`,
  `pageerror` fails the run.
## 17. Findings / candidates for work

**The authoritative registry of deviations and findings is `src/ui/README.md`, the section
"Registry of deviations from kit defaults".** Only open items are here,
requiring a product decision or future work (closed ones were removed
from the table — their state lives in code and tests).

| Severity | File | What | Direction |
|---|---|---|---|
| medium | `useAuthStore.ts` (`bootstrapPromise`) | no timeout on bootstrap itself: an unsettled promise blocks all future `bootstrap()` | covered by the 15s timeout of `apiClient`; an explicit one will be needed if the transport changes |
| low | `AppConfig.tsx` | duplicate list `THEME_VAR_NAMES`/palettes | acceptable, covered by the contrast test |
| low | `backend/src/admin/index.ts` (unban) | unban does **not** reopen the WS: after a ban the client holds `terminalTokenRef` and will log out until the app restarts | lift terminal via an HTTP bounce or document "restart the app" |

The Bot API notification channel is **implemented and enabled by default**
(`TELEGRAM_DELIVERY_ENABLED`, default `true`): flag + token + consent.
Covered by `backend/tests/e2e/botApiSend.test.ts`.

### 17.1 Deliberately left as is (code unchanged, intent recorded)

- **The card's root `onClick` was left deliberately** (registry #24).
  `Card` renders an `<article>`, has only the `type` prop and does **not have**
  `Component` (unlike `TappableProps`/`ButtonProps`), so
  a clickable Card is not provided for by the kit, while `onClick` passes typing
  through `extends HTMLAttributes`. For AT/keyboard the operation is available through
  a nested native button — progressive enhancement, WCAG is not violated.
- **A `<div>` inside a `<button>` is not a defect.** A consequence of the kit's documented
  pattern: `TappableProps.children` = `ReactNode`, and
  `Component="button"` with rich children gives `button > div`. Registry #12.
- **`settingsButton` — only on root routes** (see §12).

e2e-parity — 17 steps. The stand's `ADMIN_TOKEN` is set explicitly in `ecosystem.config.cjs`
(`backend/src/env.ts` calls `dotenv.config()` without `override`, so
shell variables win over `backend/.env`; `override: true` is not an option —
it would give priority to the gitignored `.env` over the production environment).

## 18. Invariants added by the audit (do not break)

| Invariant | Where |
|---|---|
| Account deletion is distinguished from a ban **by the code** `ACCOUNT_DELETED`, not by text. The code, the text fallback and the predicate live in the contracts (`schemas/api-error.schema.ts`), the backend imports from the same place — there is nothing to reconcile, divergence is impossible by construction. Application code takes the re-export from `@/api/client` | `useAuthStore.ts`, `ProfilePage.tsx`, `bookingErrors.ts`, `VehicleModal.tsx`, `client.ts` (re-export) |
| In the `performRefresh` branch deletion is checked **outside** "`code === FORBIDDEN`": with the new code the outer check would swallow `emitDeleted`, and a deleted user would end up on the login screen | `client.ts` (`performRefresh`) |
| 4403 distinguishes deletion from a ban by **three** reason strings: `Account is deleted` (ws-auth), `Account deleted` (DELETE /me, **without "is"**), `Account is banned`; an unknown one → `banned` + one HTTP bootstrap with a return to the default. The close frame has no `code` field, so the reason is a string, but it too lives in `WS_TERMINAL_REASON` in the contracts and is imported by the backend (ws/index.ts, users/index.ts, admin/index.ts) | `WebSocketProvider.tsx` (`classifyTerminalCloseReason`), contracts (`WS_TERMINAL_REASON`) |
| The sentinel subscription is attached at the moment the node **appears** (an effect on every render + a check against `observedRef`), not only on mount | `useInfiniteSentinel.ts` |
| The refresh result is not applied if the session has already been dropped: guard `if (!get().session) return` | `useAuthStore.ts` (`refreshSession`) |
| `markRead` is optimistic: `onMutate` + a snapshot of both caches; `markReadInPages` is pure; the counter decrement is exactly one per call | `useNotificationsQuery.ts` |
| The time of trips and notifications — only via `moscowDayKey`/`moscowTimeLabel`/`moscowDateLabel` from `utils/date.ts`; `toLocale*` without `timeZone` is forbidden | `utils/date.ts` |
| The "Mark all as read" counter — only `useUnreadCountQuery`; the segment `pages[0].unreadCount` as a global one is forbidden | `NotificationsPage.tsx` |
| `closingBehavior` is shared client state: a counter of dirty forms, not a flag | `useClosingConfirmation.ts` |
| `apiErrorSchema` in the contracts is **a shape specification without a consumer**: the client parses the body by hand in `toErrorRecord` intentionally (non-JSON/HTML from a proxy must not break the parsing and lose the HTTP status). Do not replace with `apiErrorSchema.parse` without measuring on malformed bodies. Do not propose a deletion predicate there either: the webapp is only the admin panel (`/api/v1/admin/*`, session by `ADMIN_TOKEN`), and the deleted-user state does not exist in it | `packages/contracts/src/schemas/api-error.schema.ts`, `api/client.ts` |
| `ACCOUNT_DELETED_MESSAGE`/`ACCOUNT_DELETED_CODE`/`WS_TERMINAL_REASON` are defined once in the contracts; the mock of `@/api/client` must repeat them — without that the "deleted" branches and the 4403 classifier become dead | `packages/contracts/src/schemas/api-error.schema.ts` |
| `/users/me` is described **only** by `api/profile.ts`; the resource keys are `USER_KEYS` in `queries/profile.ts` | `api/profile.ts`, `queries/profile.ts` |
| Tests: TZ-dependent behavior is checked by a file with a forced `process.env.TZ`; SSR separates adjacent text nodes with the marker `<!-- -->` | `notificationsTime.tz.test.ts` |
| `role`/`aria-live` declared on a **portal** node end up on an empty wrapper, not on the text: `Snackbar` goes into the `AppRoot` portal, and the role went to the wrapper. The role is put on the element that carries the text itself, and is checked by a DOM test — a probe by render does not see it | `components/Toast/ToastProvider.tsx`, `Toast/__tests__/ToastProvider.test.tsx` |
| `prefers-reduced-motion` for the vaul sheet — a doubled selector `[vaul-drawer][vaul-drawer]`: it raises specificity without the forbidden `!important` | `index.css` |
| **A network error of the directory is not a validation error:** `cities.isError` must give a terminal `QueryState` with "Retry", otherwise the form hangs in loading, and submit reports "Choose cities from the directory" | `CreateTripPage.tsx` (`cities.isError`) |
| A field error is bound by `FieldError` with `id` + `aria-describedby`; `Field`/`CityPickerField` accept `error`. An unbound error is readable, but does not reach the screen reader on focus | `CreateTripPage.tsx` (10 fields), `Field`, `CityPickerField` |
| An error from the profile-settings mutation is not swallowed — it is shown through `Notice` (notifications, review visibility, etc.) | `ProfilePage.tsx` |
| The `aria-label` of a menu row includes the visible caption, otherwise the name loses half its meaning ("Trip history" without "Completed and cancelled") | `ProfilePage.tsx` (`MenuRow`) |
| **An unknown number ≠ zero.** The wording "all read" is allowed only when the number is known and equals zero; with `data === undefined` the name stays neutral ("Mark all as read"), and the action stays functional — there is nothing to disable. A false statement about the state in `aria-label` is worse than the absence of a number | `NotificationsPage.tsx` |
| **The read mutation must invalidate `lists()` in `onSuccess`, not only in `onError`.** A patch from a single record's response does not update the whole feed. The counter is not refetched — it was just computed exactly | `useNotificationsQuery.ts` (`useMarkNotificationReadMutation`, `useMarkAllNotificationsReadMutation`) |
| **An on/off setting is `role="switch"`, not a checkbox.** The kit's `Switch` renders `input[type=checkbox]` and does not add a role from the wrapper, so `role="switch"` is set explicitly. We do not set `aria-checked` by hand: the browser derives it from `checked`, and duplicating it risks diverging from the real state | `ui/SwitchRow.tsx` (extracted from `ProfilePage` on 2026-10-08: the rule is needed by more than one screen — profile settings and the trip creation form) |
| **Profile tabs: the panel must be in the DOM.** `aria-controls` is attached only to the selected tab: panels are rendered conditionally, and for an unselected tab `getElementById` returns null. We did not render both with the panel as `hidden` — that would load the reviews while settings are open | `ProfilePage.tsx` (`SUBTAB_IDS`, `SUBTAB_PANEL_IDS`, `onSubtabKeyDown`) |
| **City selection is one component and always by id.** `CitySelectField` (a native `<select>`) is the only way to choose a city: home, search, trip creation, boarding request. The directory **id** is passed outward, the name is taken from the same directory. Reason: substring search by name is ambiguous, and the kit's `Multiselect` gave items without roles. Free-form manual city entry is impossible — this is deliberate | `components/CitySelect/CitySelectField.tsx`, `helpers/searchFilters.ts` |
| **The e2e run restores the stand with the seed** (`restoreDevStand` in the final block of `telegram-parity`). The step `delete: profile deletion` runs under `u-dev`, and `DELETE /me` by contract wipes the user's notifications — after the run the dev user had 0 notifications instead of 9, and the next run started with incomplete data. `reviveDevUser()` fixes only the user row, the seed restores everything. The seed fully rebuilds the DB, so it is called **after** the run's cleanup | `e2e/telegram-fixtures.mjs` (`restoreDevStand`) |
| **The screen name is set by the page, not by a section.** `NavHeader` is marked `aria-hidden`, so every route must have its own `h1` (usually `VisuallyHidden Component="h1"`). `headingLevel="h1"` on `Section` is an opt-in for "a screen where the section owns the name", and on the home page it went to the "Popular destinations" section: the screen reader announced the section name as the screen name | `pages/HomePage/HomePage.tsx`, `components/Section/PopularRoutesSection.tsx` |
| The contrast of tone/muted text is computed against **its own worst background**, not against the section background: that is the tinted plate `--app-*-bg` and the gray `#eaeaeb`/`#24303c`. For dark text the worst background is not white but the darkest of the light ones; for light text — not `#17212b` but the lightest of the dark ones. A check against the section background gives a false "passes" | `index.css`, registry #20 |
| The text tone is set by `color-mix` **with black in the light theme and with white in the dark one** (the coefficient is the minimum whole percentage for 4.5+); the `--app-*-bg` background stays the kit's. Dark tones are overridden by the selector **`.dark .app-theme`**, not `.dark`: the theme class is on `<html>`, and `.app-theme` is on the nested root, and its own declaration beats the inherited one | `index.css` |
| **The visible field label is its own, with a shared tone.** The label is drawn by `Field` itself (a visible `label`), not by the kit `header`: the kit `header` has no accessible name, exists only on `base` and sits on top of the border. The tone is the shared `--app-field-label`, the rule lives in `ui/` (class `.fieldLabel`), and **not** in the consumer's module. `Field` **always** adds its own class to the wrapper — otherwise the rule is dead | `ui/ui.module.css`, `ui/Field.tsx`, `index.css`, pin `ui/__tests__/fieldLabelTone.test.tsx` |
| **The control backdrop is gray, the label and placeholder are in tone.** All editable fields (`Field`) sit on `--tgui--secondary_bg_color`, otherwise they are not visible on a white section. The visible label (`h6`) is on a transparent background, without a pill. Placeholders are in `--app-muted` (the kit's hint is below AA on gray). The error indication is the kit's `box-shadow` ring, gray does not extinguish it | `ui/ui.module.css`, `ui/Field.tsx`, pin `ui/__tests__/fieldLabelTone.test.tsx`, the number — `e2e/ui-contrast.mjs` |
| **The kit `Select`'s `className` lands on the inner `<label>`, not on the `<select>`.** `Select` passes to `FormInput` only `header`/`before`/`status`/`className`, the rest goes to the native `select`. The controls background can be colored only because the kit's `select` = `background: inherit`. The handling of props (`id`, `value`, `onChange`, `disabled`, `aria-*`) in turn lands correctly on the `select` itself | `node_modules/@telegram-apps/telegram-ui/dist/components/Form/{Select,FormInput}/*.js` |
| **The scroll position is measured continuously, not at the moment of transition.** The transition effect in `useScrollRestore` runs already after the DOM swap, and route modals hide the background with `hidden` → the document collapses and `window.scrollY` resets to zero BEFORE it is read. 0 is saved, Back returns the list to the top | `hooks/useScrollRestore.ts`, pin `__tests__/useScrollRestore.dom.test.tsx` |
| **`hasAuthedRef` is reset only on a real loss of the session** (`session === null`). Otherwise going to the background (`status="background"`, the socket drops, the session is alive) is indistinguishable from a logout, and returning from the background — the most frequent transition in the TMA lifecycle — does not raise `resyncSeq`, i.e. what was missed during the gap is not restored (`refetchOnWindowFocus` is off) | `WebSocketProvider.tsx`, pin in `__tests__/WebSocketProvider.test.tsx` |
| **A ban is not a logout: `initData` is needed for the appeal.** `purgeLaunchParamsCache()` is called in `clearSession`/`markAccountDeleted`, but **not** on a ban. There is one entry path (`markBanned`), otherwise the WS 4403 branch or `onBanned` would forget to fill the string and the appeal form would fail | `useAuthStore.ts`, `AuthGate.tsx`, `WebSocketProvider.tsx` |
| **Error and route dictionaries are looked up only by OWN keys.** `error.code` comes from the backend response body; a direct object index returns an inherited `Object.prototype` member (`toString`, `constructor`), and it is `!== undefined`. The index signature declares the value as `string`, so **types do not catch this** — you need `Object.hasOwn` + a type check | `helpers/bookingErrors.ts`, by contrast `router/deepLinks.ts` |
| **"Tomorrow"/"Weekend" are calendar days, not "now + 24 hours".** `local midnight + 86 400 000 ms` in a zone with a DST shift gives 23:00 of the same day. Moscow is fixed by offset, so the defect is not visible in Moscow tests — the TZ file forces `Europe/Berlin` | `helpers/searchFilters.ts` |
| **TZ-dependent behavior is checked by a file with a forced `process.env.TZ`.** DST defects and "device zone instead of Moscow" **do not reproduce** on a machine in UTC or in Europe/Moscow — such tests pass and check nothing | `searchFilters.tz.test.ts` (`Europe/Berlin`), `moscowNumericDate.tz.test.ts` (`America/Los_Angeles`) |
| **Read infinite-query data only through a full optional chain** (`pages[0]?.pagination?.total`). While loading, `data` may be incomplete, and a computation BEFORE the early return will crash on `pagination` | `TripCountersSection.tsx` |
| **`useTripActions`: the "now" time advances once, at the departure boundary.** A snapshot of `Date.now()` on mount froze `canCompleteTrip` (a purely client-side gate). An interval does not fit — an open page would re-render in vain; the timer is limited to int32, otherwise "in a month" overflows and fires immediately | `pages/TripDetails/useTripActions.ts`, pin `__tests__/useTripActions.tick.test.tsx` |
| **Load more pages only when the server said the data is insufficient** (`total > loaded`) **and** stopping on `isFetchNextPageError`. Without a guard on the error — an infinite request loop, because `hasNextPage` stays `true` | `TripCountersSection.tsx` |
| **The history of ride requests and their creation are different entities:** the list is on the page `/profile/ride-requests` (a profile menu item next to "Trip history"), creation is in the popup window `RideRequestCreateModal` (`Sheet`, local state + `useModalBack`, not a route). The old route-backed sheet `/ride-requests`, where the list shared the body with the form, was removed: it mixed managing an entity with a quick action. `useClosingConfirmation` lives in the list (confirmation of leaving during unfinished inline editing). The `deepLink` of requests in the backend allowlist is `/profile/ride-requests` (`telegramNotifications.ts`) | `components/Trip/RideRequestsList.tsx`, `RideRequestCreateForm.tsx`, `pages/RideRequestHistory/` |
| **The home page shows demand, not static destinations:** the section "Who is looking for a ride" = `GET /ride-requests/feed`, which returns **a per-route summarizer**, not a list of requests: `{ fromCity, toCity, people, seats, nextAt }`. It replaced "Popular destinations" (a city list hardcoded in the code). `people` is **distinct** people (`Set` by userId: up to three active requests, two on a route ≠ two people), `seats` is the sum of seats; the numbers differ, so the row shows both ("1 person looking · 3 seats"). Sorting is by demand (`seats desc`), then by the nearest window. A request is created by the **passenger**, hence the title "who is looking for a ride", and NOT "who is being looked for as a fellow traveler" (that one inverted the roles). The backend does not return the author — the feed is anonymous; own requests are excluded. Aggregation in JS over a pool of 500 (Prisma `groupBy` cannot do `count(distinct)`) — the boundary is documented, not hidden. The row is a **static `ui/Cell`** (`STATIC_CELL`: icon, route, caption, **no chevron**, no pointer, no hover) — the same three-line language as notifications/requests; it is a showcase, not a menu. The key point in the row markup is `width: 100%`: without it the row lives at the size of its content, and a long caption stretched it beyond the section card (553px against a section of 356px on a 390 screen), and the caption wrapped to two lines and the chevron hung in the middle. Pin — `ui/__tests__/menuRow.test.tsx` (for `MenuRow`), `components/Section/__tests__/rideRequestFeedSection.test.tsx`. The caption: "2 people · 7 seats · Tomorrow, 08:00", without the words "looking"/"nearest". Rows are **not clickable**: there is no next step to promise after the invite flow was removed; own requests live in the profile. Empty/loading/error → the section **hides** (like `NextTripBanner`) | `components/Section/RideRequestFeedSection.tsx`, `backend/src/rideRequests/index.ts` |
| **The form is in a popup window, the list is on a page** (a single rule for support requests and complaints): `/profile/support` (FAQ → "My requests" → `[Create request]`, `FeedbackModal`) and `/profile/reports` (list → `[File a complaint]`, `ComplaintModal`). A fullscreen form took up the whole page. A host-managed window: `Sheet` + `OfflineBanner` (the portal overlays the global banner), Back via `useModalBack`, the list is passed into the form as a prop (the "already sent" hint). Success is a **toast**, not an inline `Notice`: the window closes, and the Notice would leave with it | `pages/Support/FeedbackModal.tsx`, `pages/Reports/ComplaintModal.tsx` |
| **A complaint has a time window, and the client list must mirror the server rule.** `canReport` and `GET /reports/targets` share one predicate: the trip has started and no more than 7 days have passed since it ended (`departureAt + durationMinutes`). Out-of-window targets are neither listed nor accepted (`403`) — otherwise the form would offer an object that fails on submit. The lower bound also closes a former gap: a passenger could report a trip that had not started yet. Prisma cannot compute `departureAt + durationMinutes`, so the DB prefilter is `departureAt ∈ [now − window − maxDuration, now]` and the exact bound is finished in JS | `backend/src/reports/index.ts`, `docs/api/reports.md` |
| **Support is one screen `/profile/support`:** the menu item leads to the page, and the request form is **in a popup window** (`FeedbackModal`, `Sheet` + local state + `useModalBack`), opened by the "Create request" button under "My requests". The page: FAQ → "My requests" → button. Therefore the e2e that measures the form (`telegram-parity`, `ui-contrast`) first opens the window — `ui-contrast` via `prepare: { click, waitFor }`, without it the step would fail with "found 0 carriers". The `FeedbackModal` sheet with a duplicate of the form was removed, and its "My requests" button was a shim to this very page. The ban appeal form lives only on the terminal screen (`AccountStatePage`/AuthGate) and in the 403 branch — not at the bottom of the page. Complaints about a user — only `/profile/reports` | `pages/Support/SupportPage.tsx`, `pages/Profile/ProfilePage.tsx` |
| **"My requests" is a list of rows + a details popup — the same canon as reports.** The feedback row is a `Cell` (subject / start of text / status) with the date and a chevron on the right, and the full text + the support reply live in `FeedbackDetailsModal` (`Sheet`, free text in `ui/Blockquote`). Previously each request was an `Accordion`: `Accordion` renders **no DOM wrapper** (only a context Provider), so its `Summary` and `Content` became two children of `SectionBody`/`Stack` and the section rhythm split every row apart — the list "floated" with no separators, and the collapsed row hid the date and the "there is an answer" status. The FAQ keeps the `Accordion` but is wrapped in a `.list` (no gap) for the same reason. Pin the **section order** (FAQ before the requests) and that the row is a `button`, not the accordion markup | `pages/Support/SupportPage.tsx`, `FeedbackDetailsModal.tsx`, `feedbackPreview.ts`, `SupportPage.module.css` |
| **In the trip history the status is its own third line, not a suffix of the date.** The row is a three-line `Cell` like notifications/reports: route → "date, time" → status with a tone (`Завершена` success / `Отменена` danger / `В архиве` muted), with the price (or the red "leave a review" badge) on the right. The status used to be glued into the `subtitle` ("date, time · status"), and the kit's one-line ellipsis truncated the key word to "Отмен…"/"Заверш…". The price needs `white-space: nowrap`, otherwise "500 ₽" breaks at the space into two lines ("500" / "₽"). The text itself is still single-sourced from `terminalTripStatusLabel` — only the tone is derived | `pages/TripHistory/TripHistoryPage.tsx`, `TripHistoryPage.module.css` |
| **`::-moz-placeholder` — only as a separate rule, never in one list with `::placeholder`:** Chromium does not know it and discards the entire selector list together with the valid ones, because of which the placeholder tone silently stayed the kit's (2.02:1) across the whole WebView on Android. The pin reads the CSS: `ui/__tests__/placeholderTone.test.ts`; the defect is not visible in jsdom/SSR. The same class of mistakes — `page.evaluate` in e2e takes exactly one argument | `ui/ui.module.css`, `ui/README.md` 9c |
| **Two actions on the home page are separate rows of one `ui/MenuRow` section («Быстрые действия»), not two buttons in one:** «Создать поездку» (subtitle «Едете на машине?», driver) and «Ищу попутку» (subtitle «Нужна попутка?», opens `RideRequestCreateModal`). A long caption is cut at ~30 characters, so the caption is only the question; what happens next is learned on the form. The old `EmptyState` CTAs were a role error (an empty-state component for a call to action): two promo blocks took ~460px and read as "nothing here". The separate «Ищу попутку» chip on the search screen was removed — one entry point, on the home page | `components/Section/HomeActionsSection.tsx`, `pages/HomePage/HomePage.tsx`, pins `__tests__/HomePage.rideRequests.test.tsx`, `homeVisual.test.ts` |
| **The date segment pill applies the filter immediately, without "Find":** `set("dateSegment", …)` changed only `form`, while the request goes from `submitted` — the pill responded visually, but the list stayed the same ("the filter doesn't work"). The whole form set is applied, not only the date. The other controls (cities, price, tags) stay on "Find" — explicit input is needed there. Consequence: the state "form neutral, request filtered" via the date pill is unreachable, the dead end with an extinguished reset reproduces only with cities/price/tags | `pages/Search/SearchPage.tsx`, pin `__tests__/SearchPage.dateSegment.test.tsx` |
| **Before "Create request" we warn that a trip already exists — and this is not a block:** `RideRequestCreateForm` first queries the existing `GET /trips` (the same `fromCityId/toCityId/dateFrom/dateTo` as the search feed — we do not introduce an endpoint of our own for the check) and, if there are matches, shows an informing dialog. Consent — a transition to the trip card and the request is **not created**, refusal — the request is created as before. There will be no separate backend endpoint here, now or later: "what already exists" is the same read-model question, a second contract would mean two truths about one thing. Dates — `moscowDayKey`, because the backend parses `dateFrom/dateTo` as Moscow days. | `components/Trip/matchingTripsSearch.ts`, `useMatchingTripCheck.ts`, pin `__tests__/rideRequestCreateForm.preSubmit.test.tsx` |
| **The defaults of trip options equal the previous behavior, and this is an irreversible requirement.** `Trip.autoComplete = false` → auto-completion by `PENDING_BOOKING_TTL_MS` (+24h, as before); `Trip.matchingEnabled = true` → unconditional matching (as before). In `createTripDtoSchema` both fields have `.default(...)`, so 25+ places of `db.trip.create` (seeds, e2e fixtures) do not set the new fields. **In the RESPONSE (`tripSchema`) the fields are required and WITHOUT a default** — "unknown" ≠ "off": with a default, a client on a stale response would decide that matching is off and show a false pin | `schema.prisma`, `dto/trip.dto.ts`, `schemas/trip.schema.ts`, pin `backend/tests/integration/trip-create-options.test.ts` |
| **`.default()` must not be put into `baseTripSchema`.** In zod 4 `ZodOptional(ZodDefault(...))` keeps the rung `defaulted` (`$ZodOptional/optin`), so `.partial()` for `PATCH` would substitute defaults even when the keys are absent — `PATCH {price: 900}` would silently reset the enabled options, and the driver would lose their choice without a single error. The schema is built so: the base has `z.boolean()` without a default, defaults only in `createTripDtoSchema` via `.extend()` | `packages/contracts/src/dto/trip.dto.ts`, pin `tests/update-trip.dto.test.ts` |
| **The passenger-matching gate is in ONE place now: `notifyMatchingRideRequests`.** It used to be three (`notifyMatchingRideRequests` / `findMatchingRideRequests` / `notifyTripsAboutNewRequest`) and the rule was "a gate on only one of them lies" — but two of the three fed the driver-side demand screen, which is gone as of 2026-10-09. What remains is the passenger direction: a published request notifies ITS AUTHOR when a matching trip appears. The gate sits in `matching.ts`, reads the flag at the moment of the call (not as a snapshot), and the predicate `matchingRideRequestWhere` is the single definition of "compatible by route and window" | `backend/src/rideRequests/matching.ts`, pin `backend/tests/integration/trip-ride-request-notify.test.ts` |
| **A negative assertion requires a pause, otherwise it is empty.** The notification broadcast is fire-and-forget (`void … .catch()`), so "there are no records right now" holds even with a BROKEN gate — a version of this case passed vacuously for exactly that reason. The correct order: publish the request BEFORE the trip (the only reachable notification path) + pause + the assertion | `backend/tests/integration/trip-create-options.test.ts`, `trip-ride-request-notify.test.ts` |
| **Worker: two passes and the predicate of ITS OWN pass in the claim.** Prisma cannot do `departureAt + durationMinutes` in `where`, so opt-in trips are taken by a separate narrow pass, and the remainder of the window is topped up in memory. The claim inside the transaction uses `autoComplete: claim.autoComplete`: a shared cutoff would give a TOCTOU — a trip whose journey is still going would be completed by the TTL cutoff. **The filter `autoComplete: false` in the candidate `where` of the default pass is an optimization, not a protection:** the protection is given by the claim, and these are different lines with different reasons. The accuracy "right at the end of the journey" is limited by the hourly `CHECK_INTERVAL_MS` | `backend/src/workers/tripWorker.ts`, pin `trip-worker-auto-complete.test.ts` |
| **`ui/SwitchRow` is a shared rule, not a profile detail.** The switch row lives in the facade because at least two screens need it (profile settings and the trip creation form); while it was private to `ProfilePage`, the second place would have been forced to copy it, and the copy would have drifted. `role="switch"` is set explicitly (the kit's `Switch` is an `input[type=checkbox]`), `aria-checked` is NOT set by hand, and the row is **not clickable as a whole**: `Component="button"` on `Cell` is forbidden (a native `Switch` inside `<button>` is invalid nesting and a double trigger) | `ui/SwitchRow.tsx`, UI registry #30, pin `ui/__tests__/switchRow.test.tsx` (by DOM, not by the source text) |
| **`showConfirm` is a STANDARD method (Bot API 6.2+), only the PROXY in the SDK is missing.** The comment in `tgConfirm` called it non-standard — that was wrong (the official doc `core.telegram.org/bots/webapps`: "shows message in a simple confirmation window with 'OK' and 'Cancel' buttons"). The answer comes through `popupClosed`+callback, not as the method's return value, so the probe goes by the presence of the function on `globalThis.Telegram.WebApp`. `window.confirm` is the PRIMARY mechanism and a deliberate trade-off: a foreign dialog diverges from Telegram's guideline "mimic the style of existing components". It is closed by an SDK bump. The final `false` is mandatory: consent is interpreted as a departure from the intent | `helpers/tgConfirm.ts`, `helpers/__tests__/tgConfirm.test.ts` |
| **A booking closes a request in the same transaction and NEVER someone else's:** `closeRideRequestsForBooking` is called inside the same Serializable transaction as `booking.create` (the closing goes **before** the insert — otherwise the passenger would get "booking exists, request still hanging"). The order of keys in `where` is critical: the spread of `matchingRideRequestWhere` returns `userId: { not: driverId }`, so the spread goes **first**, and the equality `userId: passengerId` — after, otherwise the owner check is overwritten and any booking closes strangers' requests (there is a regression test for this). The client's `requestId` takes priority (only the named one is closed), without it the server closes all matching requests of the passenger **themselves** — we do not trust the client to remember which request it is fulfilling. The race is caught by `updateMany` on `status: active` with a `count` check: mismatch → 409 and rollback. | `backend/src/bookings/rideRequests.ts`, pin `backend/tests/integration/booking-closes-ride-request.test.ts` |
| **The trip day for grouping is taken from `departureAt` via `moscowDayKey`, NOT from `trip.date`:** the backend returns `trip.date` as a formatted caption ("Sat, 15 March" — `formatDateRu`, ru-RU + Europe/Moscow), not ISO — `dayLabel()` does not work on such a string and the "Today"/"Tomorrow" captions do not appear. The order is set by the backend (`orderBy: [{departureAt:"asc"},{id:"asc"}]`), so groups are accumulated into the **adjacent** one, not through a `Map` by key: a `Map` would collapse a day interrupted by another and reorder the cards. The pill is a static centered `h2` without a counter (a group cut by pages would be counted partially) | `helpers/tripGroups.ts`, `pages/Search/TripDateDivider.tsx` |
| **A contract-shaped response is built by the single serializer and validates itself.** Hand-built `trip`/`booking` objects are forbidden: `GET /bookings/my` and `/bookings/history` assembled the nested `trip` inline and silently dropped the required `autoComplete`/`matchingEnabled`, so the client rejected the whole array with `INVALID_RESPONSE` ("Invalid server response") right after login. All booking/trip responses must go through `serializeTrip`/`serializeBooking` (`serializers/index.ts`) and `safeParse` their own payload (as `/bookings/driver` and `/bookings/trip/:id` do) — then a drift becomes a server 500 with a log, not a silent client-side rejection. Pinned by the runtime route sweep and `backend/tests/integration/telegram-parity.test.ts` | `backend/src/bookings/queries.ts`, `backend/src/serializers/index.ts` |

| **Empty ≠ "off", and demand is INFORMATION, not a driver tool.** Two decisions of 2026-10-09: (1) the demand card is GONE from the trips list, together with the whole invite flow (`POST /ride-requests/:id/invite`, the `driver_invite` notification, `invitedByMe`, the «Invite» button) — the owner dropped the invite step as redundant: the passenger books themself anyway, so the driver gained nothing from asking; (2) what remains is the home feed «Кто ищет попутку» (`GET /ride-requests/feed`), rendered as **static rows** (no button, no chevron, `STATIC_CELL`), because a showcase must not promise a navigation whose next step no longer exists. The flag `matchingEnabled` now surfaces only in the trip creation form (and `PATCH /trips/:id`): there is no driver-side demand screen and no note next to the trip in the list. The per-trip demand read (`GET /trips/:id/requests`) was removed together with the invite flow — the route does not exist. `ride_request_match` remains a backend notification type: the author of a request is notified when a matching trip appears | `pages/CreateTrip/CreateTripPage.tsx`, `components/Section/RideRequestFeedSection.tsx`, `ui/classes.ts` (`STATIC_CELL`), pin `components/Section/__tests__/rideRequestFeedSection.test.tsx` |
| **Every floating window goes through `ui/Sheet`, and the visible title is why.** The kit's `ModalHeader` renders its children ONLY when `platform === 'ios'`, so a window assembled on a raw `Modal` opens on Android/desktop with no title at all — plus no focus transfer and ~20 lines of duplicated dialog-name wiring. `ReportDetailsModal` was the last such window (fixed 2026-10-13); the move was not a product decision but collateral of a body rewrite, and the original complaint (the body looked like one solid slab) was fixed separately with `ui/Blockquote`. Pinned by class, not by role: `getByRole('heading')` also finds the hidden `VisuallyHidden` h2 and passes on BOTH versions — see `__tests__/sheetCloseRetention.test.tsx` | `ui/Sheet.tsx`, `pages/Reports/ReportDetailsModal.tsx` |
| **Content must survive the exit animation (`retained`), and it does survive `Sheet`.** vaul is a Radix Dialog wrapper, and Radix `Presence` keeps the node mounted until `animationend` (`mounted → unmount_suspended → unmounted`, `isPresent` true in the middle) — so zeroing the body together with its prop makes the window animate out EMPTY. Hold the last non-null `target`/`report` in STATE (adjusting state on props change; reading a ref during render is banned by `react-hooks/refs`, which is what a ref-based version tripped). Two consequences: the mechanism works on `Sheet` too (the earlier claim that it would not was wrong), and it is **untestable in jsdom/SSR**, where there is no animation and `animation-name: none` unmounts immediately — verify by pinning the retained state, not the animation | `ReportDetailsModal.tsx`, `FeedbackDetailsModal.tsx`, `components/Profile/UserProfileSheet.tsx`, `ui/Sheet.tsx` |
| **Free text written by a person goes through `ui/Blockquote`.** Complaint text, the moderation reply, «О себе» in the profile sheet. The wrapper exists for two shared rules: `pre-wrap` + `overflow-wrap` (typed line breaks must not collapse; a long word without spaces must not escape the plate) and the left-bar tone from `--app-*` instead of the kit's always-`link_color` — a «rejected» answer and a «no violations found» answer are different outcomes and the bar shows it. `type="other"` on purpose: the kit's `type="text"` wraps children in its own `Subheadline` and imposes its type size on descendants. Rules live in `ui/`, not in consumers' modules | `ui/Blockquote.tsx`, `ui/ui.module.css` (`.quote`), registry #35 in `ui/README.md` |

## 19. Where to look next

- `README.md` (root) — product, commands, deployment, env, API table.
- `src/ui/README.md` — the registry of deviations from the kit (#1–#59):
  **read it before a UI change**.
- `backend/ENVIRONMENT.md` — env groups with defaults (rate limits, Telegram
  delivery, metrics, logging).
- `docs/api/` — account, reports, reviews, ride-requests, feedback, admin.
- `docs/adr/` — client error reporting and Telegram notification delivery
  (both accepted).
- `e2e/README.md` — scenarios, env, determinism rules.
- `packages/contracts/src/index.ts` — Zod schemas/DTOs shared with the backend.
- `webapp/` — the admin panel (shadcn-style), a separate layer; do not confuse
  with the mini-app.
- `.opencode/skills/` — project skills (see §16).

## History of audits (compressed)

- **2026-10-08 — logic audit, 10 fixes.** `durationMinutes` rounding; double
  submit in `RideRequestCreateForm`; 4403 classifier with an unknown reason;
  Moscow date segments; `moscowDayLabel` in trip groups/feed; `closeVehicle`
  reading the store at close time; WS frame loss on a series (`subscribeEvent`);
  launch-params purge on deletion; `getRawInitData` empty → `undefined`; socket
  closed on unmount.
- **2026-10-09 — contract drift after login, 4 fixes.** `GET /bookings/my` and
  `/history` built the nested trip by hand and dropped required
  `autoComplete`/`matchingEnabled` → `INVALID_RESPONSE`; every booking/trip
  response now goes through `serializeTrip`/`serializeBooking` + `safeParse`.
  Also a Russian `INVALID_RESPONSE` message, `plural()` in `TripHero`, and the
  own ride-request list became an infinite query (was silently capped at 20).
- **2026-10-13 — UI review against the official Telegram docs, 4 fixes.**
  `interactive-widget=resizes-content`; `swapCities` haptic
  (`impactOccurred(light)`, not `selection`); safe-area comment scoped to
  outside Telegram; `Toast` doubling comment restored (the selector was kept).
- **2026-10-13 — facade audit, 3 latent bugs.** `ui/Chip` spread could overwrite
  `Component="button"`; `ui/Switcher` lost its tabbable item with an unknown
  value / empty options; `ui/Sheet` static body lacked focus rules. Contract
  drift in `ui/README.md` corrected (gray `Button`, ban list, `#15`, `#23`,
  rows `#33–#37`).
- **2026-10-19 — UI pass.** One `Switcher` look (no `stretch` option); screen
  pass (44×44 swap, primary empty-state action, header by the open sheet);
  two-line clamp for report/support titles, route without the «Маршрут: »
  label, 44px profile edit button, «Отзыв о водителе: Имя» wording. Registry
  #57–#59.
