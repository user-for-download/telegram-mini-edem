# Telegram migration parity matrix

**Baseline:** [VK reference baseline](./tg-reference-baseline.md) (2026-09-09). `mini-app/` is frozen and read-only; all product work belongs to Telegram/shared backend.
**Statuses:** `implemented` = complete reachable TG journey; `gap` = required behavior missing/incomplete; `decision` = product/architecture choice required; `not applicable` = VK-platform behavior intentionally has no TG equivalent.

## Routes and navigation

| VK reference | TG status | Evidence and required work |
|---|---|---|
| `/` home dashboard | `gap` | VK route: [`router/index.ts:24-27`](../../mini-app/src/router/index.ts#L24-L27); TG wildcard redirects to search and `HomePage` is not routed: [`AppRouter.tsx:106-120`](../../telegram-app/src/router/AppRouter.tsx#L106-L120). Port greeting, role CTA and upcoming activity. |
| `/home/trip/:tripId` home-context detail | `not applicable` | VK route alias: [`router/index.ts:29-32`](../../mini-app/src/router/index.ts#L29-L32). TG has one canonical detail route: [`AppRouter.tsx:111-113`](../../telegram-app/src/router/AppRouter.tsx#L111-L113). |
| `/trips` search | `implemented` | TG route and search/pagination UI: [`AppRouter.tsx:111-112`](../../telegram-app/src/router/AppRouter.tsx#L111-L112), [`SearchPage.tsx:8-44`](../../telegram-app/src/pages/SearchPage.tsx#L8-L44). |
| `/trips/search` search alias | `not applicable` | VK alias: [`router/index.ts:41-44`](../../mini-app/src/router/index.ts#L41-L44); TG canonicalizes search at `/trips`. |
| `/trips/my` driver trips | `implemented` | TG route: [`AppRouter.tsx:113-115`](../../telegram-app/src/router/AppRouter.tsx#L113-L115); list and lifecycle controls: [`MyTripsPage.tsx:9-14`](../../telegram-app/src/pages/MyTripsPage.tsx#L9-L14). Archive filtering parity remains an action gap below. |
| `/trips/my/:tripId/requests` | `implemented` | TG route: [`AppRouter.tsx:113-115`](../../telegram-app/src/router/AppRouter.tsx#L113-L115); accept/decline and pagination: [`TripRequestsModal.tsx:190-355`](../../telegram-app/src/components/Trip/TripRequestsModal.tsx#L190-L355). |
| Create trip (VK modal) | `implemented` | TG-native route `/trips/my/new`: [`AppRouter.tsx:115`](../../telegram-app/src/router/AppRouter.tsx#L115), form/contract/navigation: [`CreateTripPage.tsx:12-57`](../../telegram-app/src/pages/CreateTripPage.tsx#L12-L57). |
| `/ride-requests` | `implemented` | TG route: [`AppRouter.tsx:118`](../../telegram-app/src/router/AppRouter.tsx#L118); create/edit UI: [`RideRequestsModal.tsx:104-230`](../../telegram-app/src/components/Trip/RideRequestsModal.tsx#L104-L230); pause/resume/cancel: [`RideRequestsModal.tsx:470-530`](../../telegram-app/src/components/Trip/RideRequestsModal.tsx#L470-L530). |
| `/bookings` | `implemented` | TG route: [`AppRouter.tsx:116`](../../telegram-app/src/router/AppRouter.tsx#L116); open and cancel pending booking: [`PassengerBookingsPage.tsx:8-12`](../../telegram-app/src/pages/PassengerBookingsPage.tsx#L8-L12). |
| `/bookings/history` | `implemented` | TG route and list: [`AppRouter.tsx:117`](../../telegram-app/src/router/AppRouter.tsx#L117), [`HistoryPage.tsx:6-8`](../../telegram-app/src/pages/HistoryPage.tsx#L6-L8). Review/filter actions are gaps below. |
| `/trips/:tripId` | `implemented` | TG route and detail/status/booking surface: [`AppRouter.tsx:112`](../../telegram-app/src/router/AppRouter.tsx#L112), [`TripDetailsPage.tsx:10-36`](../../telegram-app/src/pages/TripDetailsPage.tsx#L10-L36). Advanced actions are tracked below. |
| `/profile` | `gap` | VK route: [`router/index.ts:78-81`](../../mini-app/src/router/index.ts#L78-L81); no TG profile route among registered routes: [`AppRouter.tsx:106-120`](../../telegram-app/src/router/AppRouter.tsx#L106-L120). |
| `/profile/reviews` | `gap` | VK route: [`router/index.ts:83-86`](../../mini-app/src/router/index.ts#L83-L86); TG has review API but no route/page: [`telegram-app/src/api/reviews.api.ts:29-52`](../../telegram-app/src/api/reviews.api.ts#L29-L52). |
| `/profile/notifications` | `gap` | VK route: [`router/index.ts:88-91`](../../mini-app/src/router/index.ts#L88-L91); TG has preference API only and no route: [`telegram-app/src/api/users.api.ts:51-59`](../../telegram-app/src/api/users.api.ts#L51-L59). |
| `/profile/support` | `gap` | VK route: [`router/index.ts:93-96`](../../mini-app/src/router/index.ts#L93-L96); TG has no feedback API/page in its source API/page sets. Backend remains mounted: [`backend/src/app.ts:214-218`](../../backend/src/app.ts#L214-L218). |
| `/profile/about` | `gap` | VK route: [`router/index.ts:98-101`](../../mini-app/src/router/index.ts#L98-L101); no TG route: [`AppRouter.tsx:106-120`](../../telegram-app/src/router/AppRouter.tsx#L106-L120). |
| `/profile/about/terms` | `gap` | VK route: [`router/index.ts:103-106`](../../mini-app/src/router/index.ts#L103-L106); no TG legal route or consent gate. |
| `/profile/about/privacy` | `gap` | VK route: [`router/index.ts:108-111`](../../mini-app/src/router/index.ts#L108-L111); no TG legal route or consent gate. |
| Unknown route fallback | `implemented` | VK falls home: [`router/index.ts:113-116`](../../mini-app/src/router/index.ts#L113-L116); TG deterministically redirects to `/trips`: [`AppRouter.tsx:119`](../../telegram-app/src/router/AppRouter.tsx#L119). |
| Native back/tab navigation | `implemented` | TG SDK Back Button and three root tabs: [`AppRouter.tsx:36-57`](../../telegram-app/src/router/AppRouter.tsx#L36-L57), [`AppRouter.tsx:73-101`](../../telegram-app/src/router/AppRouter.tsx#L73-L101). Profile tab is missing with the profile route. |

## User actions

| Capability frozen from VK | TG status | Evidence and required work |
|---|---|---|
| Passenger/driver role switch and persistence | `gap` | VK persists role and changes role-dependent UI: [`mini-app/src/App.tsx:42-57`](../../mini-app/src/App.tsx#L42-L57), [`ProfilePanel.tsx:183-214`](../../mini-app/src/views/ProfileView/panels/ProfilePanel/ProfilePanel.tsx#L183-L214). TG has fixed tabs and no role setting. |
| Home greeting, nearby trips and next own activity | `gap` | VK behavior: [`HomePanel.tsx:101-131`](../../mini-app/src/views/HomeView/panels/HomePanel/HomePanel.tsx#L101-L131). TG does not route `HomePage`; search is the landing page. |
| Search by route/city/address and paginate | `implemented` | [`SearchPage.tsx:8-44`](../../telegram-app/src/pages/SearchPage.tsx#L8-L44). |
| Search date/from/to filters equivalent to VK | `gap` | TG submits only `{q}`: [`SearchPage.tsx:9-12`](../../telegram-app/src/pages/SearchPage.tsx#L9-L12); shared trip API accepts richer filters: [`telegram-app/src/api/trips.api.ts:35-45`](../../telegram-app/src/api/trips.api.ts#L35-L45). |
| Create trip | `implemented` | [`CreateTripPage.tsx:12-57`](../../telegram-app/src/pages/CreateTripPage.tsx#L12-L57). |
| Edit trip | `gap` | TG API wrapper exists: [`telegram-app/src/api/trips.api.ts:80-85`](../../telegram-app/src/api/trips.api.ts#L80-L85), but TG pages expose no edit action; VK exposes it: [`TripDetailsPanel.tsx:824-833`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L824-L833). |
| Driver active/archive views and request counts | `gap` | VK tabs/counts: [`TripsManagePanel.tsx:30-51`](../../mini-app/src/views/ActionView/panels/TripsManagePanel/TripsManagePanel.tsx#L30-L51). TG renders one list without tabs/count labels: [`MyTripsPage.tsx:9-14`](../../telegram-app/src/pages/MyTripsPage.tsx#L9-L14). |
| Cancel/complete own trip | `implemented` | TG controls: [`MyTripsPage.tsx:9-14`](../../telegram-app/src/pages/MyTripsPage.tsx#L9-L14); API wrappers: [`telegram-app/src/api/trips.api.ts:87-99`](../../telegram-app/src/api/trips.api.ts#L87-L99). |
| Complete only after departure and confirm destructive actions | `gap` | VK enforces time and confirmations: [`TripDetailsPanel.tsx:433-485`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L433-L485). TG list calls cancel/complete directly without confirmation: [`MyTripsPage.tsx:9-14`](../../telegram-app/src/pages/MyTripsPage.tsx#L9-L14). Backend remains authoritative, but UX parity is absent. |
| View trip details including addresses, tags, duration/distance/price | `gap` | VK detail: [`TripDetailsPanel.tsx:499-585`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L499-L585). TG shows route/date/seats/driver/car and price only on booking CTA: [`TripDetailsPage.tsx:23-33`](../../telegram-app/src/pages/TripDetailsPage.tsx#L23-L33). |
| Open another user's profile/reviews | `gap` | VK driver/passenger profile entry points: [`TripDetailsPanel.tsx:110-114`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L110-L114), [`TripDetailsPanel.tsx:521-566`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L521-L566). TG renders driver text only: [`TripDetailsPage.tsx:28-29`](../../telegram-app/src/pages/TripDetailsPage.tsx#L28-L29). |
| Choose seat and add booking comment | `gap` | VK seat/comment form: [`TripDetailsPanel.tsx:724-797`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L724-L797). TG hard-codes seat `1` and has no comment: [`TripDetailsPage.tsx:32-34`](../../telegram-app/src/pages/TripDetailsPage.tsx#L32-L34). |
| Create booking and see status | `implemented` | [`TripDetailsPage.tsx:20-34`](../../telegram-app/src/pages/TripDetailsPage.tsx#L20-L34). |
| Cancel active booking | `implemented` | TG booking list cancellation: [`PassengerBookingsPage.tsx:8-12`](../../telegram-app/src/pages/PassengerBookingsPage.tsx#L8-L12). Cancellation from detail and confirmation remain UX gaps. |
| Driver views, paginates and accepts/declines requests | `implemented` | [`TripRequestsModal.tsx:190-355`](../../telegram-app/src/components/Trip/TripRequestsModal.tsx#L190-L355). |
| View confirmed passengers and open/contact them | `gap` | VK separates confirmed passengers and opens profile: [`TripDetailsPanel.tsx:678-693`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L678-L693). TG request page lists all statuses but has no profile/contact action: [`TripRequestsModal.tsx:190-355`](../../telegram-app/src/components/Trip/TripRequestsModal.tsx#L190-L355). |
| Create/pause/resume/cancel ride request | `implemented` | [`RideRequestsModal.tsx:104-230`](../../telegram-app/src/components/Trip/RideRequestsModal.tsx#L104-L230) (create/edit), [`RideRequestsModal.tsx:470-530`](../../telegram-app/src/components/Trip/RideRequestsModal.tsx#L470-L530) (pause/resume/cancel). |
| Edit ride request | `implemented` | PATCH helper: [`telegram-app/src/api/rideRequests.api.ts:39-46`](../../telegram-app/src/api/rideRequests.api.ts#L39-L46); inline edit UI: [`RideRequestsModal.tsx:169-230`](../../telegram-app/src/components/Trip/RideRequestsModal.tsx#L169-L230). |
| History filters and open trip | `gap` | VK all/completed/cancelled filter and open action: [`PassengerHistoryPanel.tsx:28-35`](../../mini-app/src/views/ActionView/panels/PassengerHistoryPanel/PassengerHistoryPanel.tsx#L28-L35), [`PassengerHistoryPanel.tsx:134-180`](../../mini-app/src/views/ActionView/panels/PassengerHistoryPanel/PassengerHistoryPanel.tsx#L134-L180). TG history cells have no action/filter: [`HistoryPage.tsx:6-8`](../../telegram-app/src/pages/HistoryPage.tsx#L6-L8). |
| List authored/about-user reviews | `gap` | TG client implements both reads: [`telegram-app/src/api/reviews.api.ts:29-47`](../../telegram-app/src/api/reviews.api.ts#L29-L47), but no review UI/route exists. |
| Select eligible trip and create review | `gap` | TG client supports eligible trips/create: [`telegram-app/src/api/reviews.api.ts:37-52`](../../telegram-app/src/api/reviews.api.ts#L37-L52); no reachable UI. VK flow: [`ReviewsPanel.tsx:193-207`](../../mini-app/src/views/ProfileView/panels/ReviewsPanel/ReviewsPanel.tsx#L193-L207). |
| Report a trip and show already-reported state | `gap` | VK action/state: [`TripDetailsPanel.tsx:127-137`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L127-L137), [`TripDetailsPanel.tsx:864-874`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L864-L874). TG has neither reports API module nor UI; backend routes exist: [`backend/src/reports/index.ts:87-110`](../../backend/src/reports/index.ts#L87-L110). |
| View/edit own profile | `gap` | TG users client supports GET/PATCH: [`telegram-app/src/api/users.api.ts:18-34`](../../telegram-app/src/api/users.api.ts#L18-L34); no profile route/UI. |
| Add/edit car | `gap` | TG client supports car upsert: [`telegram-app/src/api/users.api.ts:35-41`](../../telegram-app/src/api/users.api.ts#L35-L41); no UI. |
| Delete account with confirmation and obligation errors | `gap` | TG client supports DELETE: [`telegram-app/src/api/users.api.ts:62-64`](../../telegram-app/src/api/users.api.ts#L62-L64) and store terminal state: [`useAuthStore.ts:342-345`](../../telegram-app/src/store/useAuthStore.ts#L342-L345), but no reachable action/confirmation. Backend behavior is covered: [`profile-deletion.test.ts:32-75`](../../backend/tests/integration/profile-deletion.test.ts#L32-L75). |
| FAQ, feedback list/create/detail/reply | `gap` | VK journey: [`SupportPanel.tsx:100-174`](../../mini-app/src/views/ProfileView/panels/SupportPanel/SupportPanel.tsx#L100-L174). TG has no feedback API/page; backend supports create/appeal/list: [`backend/src/feedback/index.ts:33-133`](../../backend/src/feedback/index.ts#L33-L133). |
| External support links | `decision` | VK conditionally opens configured links: [`SupportPanel.tsx:179-218`](../../mini-app/src/views/ProfileView/panels/SupportPanel/SupportPanel.tsx#L179-L218). Decide Telegram support destination (bot chat, username or web URL). |
| Share trip | `gap` | VK exposes share: [`TripDetailsPanel.tsx:257-265`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L257-L265). TG detail has no share action: [`TripDetailsPage.tsx:21-37`](../../telegram-app/src/pages/TripDetailsPage.tsx#L21-L37). |
| Contact participant | `decision` | VK opens VK DM only for eligible active-booking participants: [`TripDetailsPanel.tsx:603-615`](../../mini-app/src/panels/TripDetailsPanel/TripDetailsPanel.tsx#L603-L615). Decide privacy-safe TG contact mechanism; do not assume Telegram username is present/shareable. |
| Offline indicator and recovery | `gap` | VK mounts an offline banner: [`mini-app/src/App.tsx:193-196`](../../mini-app/src/App.tsx#L193-L196). TG has query retry states but no global offline state. |

## API and shared contracts

Status here means a Telegram client wrapper and shared backend route exist; reachability is assessed separately above.

| API capability | TG status | Evidence |
|---|---|---|
| `POST /auth/telegram` | `implemented` | Client: [`telegram-app/src/api/auth.api.ts:4-10`](../../telegram-app/src/api/auth.api.ts#L4-L10); backend: [`backend/src/auth/index.ts:209-346`](../../backend/src/auth/index.ts#L209-L346); integration tests: [`telegram-auth.test.ts:79-155`](../../backend/tests/integration/telegram-auth.test.ts#L79-L155). |
| `POST /auth/refresh` and automatic rotation | `implemented` | Client/store: [`telegram-app/src/api/auth.api.ts:12-17`](../../telegram-app/src/api/auth.api.ts#L12-L17), [`useAuthStore.ts:219-290`](../../telegram-app/src/store/useAuthStore.ts#L219-L290); backend route starts at [`backend/src/auth/index.ts:349`](../../backend/src/auth/index.ts#L349). |
| `POST /auth/logout` | `gap` | Backend exists: [`backend/src/auth/index.ts:499`](../../backend/src/auth/index.ts#L499); TG has no logout API/action and `clearSession` is local only: [`useAuthStore.ts:326-340`](../../telegram-app/src/store/useAuthStore.ts#L326-L340). |
| Trips: list/detail/my/create/update/cancel/complete | `implemented` | TG wrappers: [`telegram-app/src/api/trips.api.ts:42-99`](../../telegram-app/src/api/trips.api.ts#L42-L99); backend mounted: [`backend/src/app.ts:212`](../../backend/src/app.ts#L212). |
| Bookings: my/history/by-trip/create/status/cancel | `implemented` | TG wrappers: [`telegram-app/src/api/bookings.api.ts:18-63`](../../telegram-app/src/api/bookings.api.ts#L18-L63); backend route set: [`backend/src/bookings/index.ts:144-1163`](../../backend/src/bookings/index.ts#L144-L1163). |
| Cities suggest | `implemented` | TG wrapper: [`telegram-app/src/api/cities.api.ts:10-16`](../../telegram-app/src/api/cities.api.ts#L10-L16); backend: [`backend/src/cities/index.ts:37`](../../backend/src/cities/index.ts#L37). |
| Ride requests: list/create/update/status/delete | `implemented` | TG wrappers: [`telegram-app/src/api/rideRequests.api.ts:25-61`](../../telegram-app/src/api/rideRequests.api.ts#L25-L61); backend route set: [`backend/src/rideRequests/index.ts:48-358`](../../backend/src/rideRequests/index.ts#L48-L358). |
| Users: me/public/update/car/onboarding/preferences/delete | `implemented` | TG wrappers: [`telegram-app/src/api/users.api.ts:18-64`](../../telegram-app/src/api/users.api.ts#L18-L64); backend route set: [`backend/src/users/index.ts:39-250`](../../backend/src/users/index.ts#L39-L250). |
| Reviews: user/create/my/available trips | `implemented` | TG wrappers: [`telegram-app/src/api/reviews.api.ts:29-52`](../../telegram-app/src/api/reviews.api.ts#L29-L52); backend route set: [`backend/src/reviews/index.ts:158-410`](../../backend/src/reviews/index.ts#L158-L410). |
| Feedback: create/appeal/list | `gap` | VK wrappers: [`mini-app/src/api/feedback.api.ts:21-55`](../../mini-app/src/api/feedback.api.ts#L21-L55); backend: [`backend/src/feedback/index.ts:33-133`](../../backend/src/feedback/index.ts#L33-L133); no TG wrapper. |
| Reports: create/list | `gap` | VK wrappers: [`mini-app/src/api/reports.api.ts:9-12`](../../mini-app/src/api/reports.api.ts#L9-L12); backend: [`backend/src/reports/index.ts:87-110`](../../backend/src/reports/index.ts#L87-L110); no TG wrapper. |
| Notifications: inbox/read/read-all | `gap` | VK wrappers: [`mini-app/src/api/notifications.api.ts:25-50`](../../mini-app/src/api/notifications.api.ts#L25-L50); backend: [`backend/src/notifications/index.ts:19-93`](../../backend/src/notifications/index.ts#L19-L93); no TG wrapper. |
| Shared DTO/schema parsing | `implemented` | Contract exports: [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts); TG uses contract validation, e.g. ride-request creation: [`RideRequestsModal.tsx:28-29`](../../telegram-app/src/components/Trip/RideRequestsModal.tsx#L28-L29), [`RideRequestsModal.tsx:142-210`](../../telegram-app/src/components/Trip/RideRequestsModal.tsx#L142-L210). |

## Notifications and real time

| Capability | TG status | Evidence and required work |
|---|---|---|
| Persist in-app notifications, including critical events when optional notifications are off | `implemented` | Shared backend policy: [`notification.service.ts:5-36`](../../backend/src/services/notification.service.ts#L5-L36). |
| Notification preference | `gap` | TG API wrapper exists: [`telegram-app/src/api/users.api.ts:51-59`](../../telegram-app/src/api/users.api.ts#L51-L59), but no settings UI. |
| Notification inbox/unread/read controls | `gap` | Backend supports all operations: [`backend/src/notifications/index.ts:19-93`](../../backend/src/notifications/index.ts#L19-L93); TG has no module/page. VK itself had a client but no consumed inbox, which does not waive explicit migration scope: [`GlobalWsListener.tsx:33-37`](../../mini-app/src/components/GlobalWsListener.tsx#L33-L37). |
| Foreground booking/trip event updates | `gap` | VK invalidates queries and shows event messages: [`GlobalWsListener.tsx:39-117`](../../mini-app/src/components/GlobalWsListener.tsx#L39-L117). Backend WS endpoint exists: [`backend/src/app.ts:223`](../../backend/src/app.ts#L223); TG has no WebSocket provider/listener. |
| WS authentication, ping/pong, reconnect, refresh and resync | `gap` | Frozen implementation: [`mini-app/src/providers/WsProvider.tsx:88-192`](../../mini-app/src/providers/WsProvider.tsx#L88-L192). Shared event contract exists: [`packages/contracts/src/ws.ts:1-6`](../../packages/contracts/src/ws.ts#L1-L6); no TG consumer. |
| Background external notifications through Telegram Bot API | `decision` | Current service imports and invokes VK push only: [`notification.service.ts:1-4`](../../backend/src/services/notification.service.ts#L1-L4), [`notification.service.ts:38-45`](../../backend/src/services/notification.service.ts#L38-L45). Decide opt-in, bot-chat availability, event set, deep-link format, retries and privacy; implement Bot API delivery if required for parity. |
| VK message permission and VK push permission | `not applicable` | VK-specific controls: [`NotificationsPanel.tsx:52-127`](../../mini-app/src/views/ProfileView/panels/NotificationsPanel/NotificationsPanel.tsx#L52-L127). Telegram-native bot consent/delivery is the decision above, not a literal permission port. |

## Deep links

| Entry/action | TG status | Evidence and required work |
|---|---|---|
| Open trip from launch parameter | `implemented` | TG accepts UUID or `trip_<uuid>` and navigates once: [`AppRouter.tsx:28-34`](../../telegram-app/src/router/AppRouter.tsx#L28-L34), [`AppRouter.tsx:59-65`](../../telegram-app/src/router/AppRouter.tsx#L59-L65); parser test: [`telegram-app/src/router/__tests__/startParam.test.ts`](../../telegram-app/src/router/__tests__/startParam.test.ts). |
| Open booking history | `gap` | VK supports `openHistory=true`: [`mini-app/src/helpers/deepLink.ts:38-40`](../../mini-app/src/helpers/deepLink.ts#L38-L40); TG handles trip start parameters only. |
| Open driver/user profile | `gap` | VK supports `driverId`: [`mini-app/src/helpers/deepLink.ts:44-46`](../../mini-app/src/helpers/deepLink.ts#L44-L46), [`mini-app/src/App.tsx:108-112`](../../mini-app/src/App.tsx#L108-L112); TG has no profile route/start-param mapping. |
| `modal` query parameter | `not applicable` | VK parser returns it, but VK `App` handles only trip/history/driver: [`mini-app/src/helpers/deepLink.ts:41-43`](../../mini-app/src/helpers/deepLink.ts#L41-L43), [`mini-app/src/App.tsx:92-113`](../../mini-app/src/App.tsx#L92-L113). It is not frozen functional behavior. |
| Shareable Telegram trip link | `gap` | Start-param receiving exists, but TG detail has no share action: [`TripDetailsPage.tsx:21-37`](../../telegram-app/src/pages/TripDetailsPage.tsx#L21-L37). Generate the bot/Mini App link in the same accepted `trip_<uuid>` format. |
| Notification tap destination | `decision` | Shared service accepts VK hash `fragment`: [`notification.service.ts:17-24`](../../backend/src/services/notification.service.ts#L17-L24). Define Bot API button/start-parameter mapping for trip, bookings/history and other event targets. |

## Authentication, consent and account lifecycle

| State/transition | TG status | Evidence and required work |
|---|---|---|
| Idle → initializing → authenticated using raw platform payload | `implemented` | Raw `retrieveRawInitData()` is sent unchanged: [`useAuthStore.ts:61-83`](../../telegram-app/src/store/useAuthStore.ts#L61-L83), bootstrap: [`useAuthStore.ts:176-217`](../../telegram-app/src/store/useAuthStore.ts#L176-L217). |
| Invalid/missing/expired init data and retry | `implemented` | Store maps failure to unauthenticated: [`useAuthStore.ts:195-210`](../../telegram-app/src/store/useAuthStore.ts#L195-L210); gate exposes retry: [`AuthGate.tsx:147-178`](../../telegram-app/src/components/AuthGate.tsx#L147-L178). Backend rejection tests: [`telegram-auth.test.ts:188-208`](../../backend/tests/integration/telegram-auth.test.ts#L188-L208). |
| Auth rate-limit cooldown | `implemented` | [`AuthGate.tsx:6-45`](../../telegram-app/src/components/AuthGate.tsx#L6-L45), [`AuthGate.tsx:148-166`](../../telegram-app/src/components/AuthGate.tsx#L148-L166). |
| Banned terminal state with reason | `implemented` | Store/gate: [`useAuthStore.ts:126-139`](../../telegram-app/src/store/useAuthStore.ts#L126-L139), [`AuthGate.tsx:124-135`](../../telegram-app/src/components/AuthGate.tsx#L124-L135); backend test: [`telegram-auth.test.ts:210-234`](../../backend/tests/integration/telegram-auth.test.ts#L210-L234). |
| Banned-user appeal action | `gap` | TG button has no handler: [`AuthGate.tsx:124-133`](../../telegram-app/src/components/AuthGate.tsx#L124-L133). Store retains raw init data for future appeal: [`useAuthStore.ts:34-40`](../../telegram-app/src/store/useAuthStore.ts#L34-L40); backend appeal exists: [`backend/src/feedback/index.ts:78`](../../backend/src/feedback/index.ts#L78). |
| Deleted terminal state and tombstone re-login rejection | `implemented` | TG gate/store: [`AuthGate.tsx:138-145`](../../telegram-app/src/components/AuthGate.tsx#L138-L145), [`useAuthStore.ts:142-152`](../../telegram-app/src/store/useAuthStore.ts#L142-L152); backend test: [`telegram-auth.test.ts:237-249`](../../backend/tests/integration/telegram-auth.test.ts#L237-L249). Reachable deletion action remains a gap above. |
| Foreground/background session handling | `implemented` | Visibility subscription: [`AuthGate.tsx:107-118`](../../telegram-app/src/components/AuthGate.tsx#L107-L118); state/refresh transition: [`useAuthStore.ts:293-324`](../../telegram-app/src/store/useAuthStore.ts#L293-L324). |
| Silent refresh, expiry, ban during session | `implemented` | Gate subscriptions: [`AuthGate.tsx:53-105`](../../telegram-app/src/components/AuthGate.tsx#L53-L105); store single-flight refresh: [`useAuthStore.ts:219-290`](../../telegram-app/src/store/useAuthStore.ts#L219-L290). |
| First-run onboarding and legal consent before app/WS | `gap` | VK blocks app until persisted acceptance: [`mini-app/src/AppConfig.tsx:94-103`](../../mini-app/src/AppConfig.tsx#L94-L103), [`mini-app/src/components/ConsentGate.tsx:103-130`](../../mini-app/src/components/ConsentGate.tsx#L103-L130). TG mounts `AuthGate` directly around the app: [`telegram-app/src/AppConfig.tsx:76-87`](../../telegram-app/src/AppConfig.tsx#L76-L87), despite having an onboarding API wrapper. |
| View terms/privacy during consent and from profile | `gap` | VK consent links: [`ConsentGate.tsx:237-285`](../../mini-app/src/components/ConsentGate.tsx#L237-L285); TG has no legal pages/routes. |
| Decline consent and delete data | `gap` | VK flow: [`ConsentGate.tsx:132-163`](../../mini-app/src/components/ConsentGate.tsx#L132-L163), [`ConsentGate.tsx:168-192`](../../mini-app/src/components/ConsentGate.tsx#L168-L192); TG has no consent UI. |
| Production account/data migration from VK | `not applicable` | Project constraint: no production data exist. No production records need transfer or VK↔TG account linking. Dev/seed/test data are non-production and may be reset. |
| Optional VK↔TG account linking | `not applicable` | With no production accounts, linking is not a rollout prerequisite. Do not merge identities based on display name/avatar. Revisit only if production data are introduced before cutover. |

## Exit view: unresolved work

### Gaps

1. Profile/settings/legal/support/report/review routes and complete user journeys.
2. Consent/onboarding gate and reachable account editing, car management and deletion.
3. Home/role parity and richer search, trip-detail, booking-seat/comment, archive/history flows.
4. Trip/ride-request editing, confirmation guards, profiles/contact, sharing and offline feedback.
5. Telegram notification inbox/preferences and WebSocket real-time behavior.
6. Logout route use and banned-user appeal wiring.

### Decisions

1. Whether and how Telegram Bot API messages provide external/background notifications.
2. Notification deep-link/button mapping for Telegram start parameters.
3. Privacy-safe participant contact mechanism in place of VK direct messages.
4. Telegram support destination for optional external support links.

Production data migration and VK↔TG account linking are explicitly **not applicable** under the no-production-data constraint.
