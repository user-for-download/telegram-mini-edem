import { useCallback, useEffect, useRef } from "react";
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";
import { backButton, useLaunchParams } from "@tma.js/sdk-react";
import {
  AppBottomBar,
  type AppTabId,
} from "@/components/AppBottomBar/AppBottomBar";
import { AppShell } from "@/components/AppShell/AppShell";
import { NavHeader } from "@/components/NavHeader/NavHeader";
import { useSettingsButton } from "@/hooks/useSettingsButton";
import { useScrollRestore, routeScrollKey } from "@/hooks/useScrollRestore";
import { handleModalBack } from "@/utils/modalBack";
import { ROUTE_FADE_CLASS } from "@/components/AppShell/AppShell";
import { HomePage } from "@/pages/HomePage/HomePage";
import { SearchPage } from "@/pages/Search/SearchPage";
import {
  TripDetailsRoute,
  TripDetailsSheet,
} from "@/components/Trip/TripDetailsModal";
import { CreateTripPage } from "@/pages/CreateTrip/CreateTripPage";
import { NotificationsPage } from "@/pages/Notifications/NotificationsPage";
import { VehicleRoute } from "@/components/Profile/VehicleModal";
import { TripPage } from "@/pages/Trip/TripPage";
import { TripHistoryPage } from "@/pages/TripHistory/TripHistoryPage";
import { RideRequestHistoryPage } from "@/pages/RideRequestHistory/RideRequestHistoryPage";
import { TripRequestsRoute } from "@/components/Trip/TripRequestsModal";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import { EditProfileRoute } from "@/components/Profile/EditProfileModal";
import { UserProfileProvider } from "@/components/Profile/UserProfileProvider";
import { useUnreadCountQuery } from "@/queries/useNotificationsQuery";
import { ReviewsPage } from "@/pages/Reviews/ReviewsPage";
import { SettingsRoute } from "@/components/Profile/SettingsModal";
import { SupportPage } from "@/pages/Support/SupportPage";
import { ReportsPage } from "@/pages/Reports/ReportsPage";
import {
  parseTripStartParam,
  resolveStartParamRoute,
} from "@/router/deepLinks";

export { parseTripStartParam };

const ROOT_ROUTES = new Set([
  "/",
  "/trips",
  "/bookings",
  "/notifications",
  "/profile",
]);

// Уровень модуля — не пересоздаётся на каждый рендер Shell.
const HEADER_TITLE_RULES: [(p: string) => boolean, string][] = [
  [(p) => p === "/", "Главная"],
  [(p) => p === "/trips/my/new", "Создание поездки"],
  [(p) => p.startsWith("/trips/my"), "Мои поездки"],
  [(p) => p.startsWith("/bookings"), "Поездки"],
  [(p) => p.startsWith("/trips/"), "Поездка"],
  [(p) => p.startsWith("/trips"), "Поиск"],
  [(p) => p.startsWith("/notifications"), "Уведомления"],
  [(p) => p.startsWith("/profile/history"), "История поездок"],
  [(p) => p.startsWith("/profile/ride-requests"), "История запросов"],
  [(p) => p.startsWith("/profile/edit"), "Редактирование профиля"],
  [(p) => p.startsWith("/profile/support"), "Поддержка"],
  [(p) => p.startsWith("/profile/reports"), "Жалобы"],
  // Шторки поверх профиля, открываемые с экрана профиля. Обе — deep-link
  // цели из бэкенда (telegramNotifications.ts), и без правила NavHeader
  // возвращал null: 44px шапка исчезала на обеих страницах, тогда как у
  // /profile/edit (тот же паттерн «профиль + шторка») заголовок был.
  // Названия — по строкам меню профиля, которые эти шторки открывают.
  [(p) => p === "/settings", "Настройки"],
  [(p) => p === "/vehicle", "Автомобиль"],
  [(p) => p.startsWith("/reviews"), "Отзывы"],
  [(p) => p.startsWith("/profile"), "Профиль"],
];

/** Состояние навигации, которым route-шторка помечает свой фон. */
interface BackgroundState {
  /**
   * Экран, с которого открыли шторку. Кладёт `useOpenTrip` (детали поездки);
   * роутер рисует по этому адресу прежнюю страницу, а шторку — поверх.
   */
  backgroundLocation?: Location;
}

/**
 * Адрес ЭКРАНА под шторкой: при открытой route-модалке это фон, иначе
 * текущий адрес. От него зависят активный таб, заголовок и ключ анимации —
 * иначе, открыв детали поездки из «Уведомлений», пользователь видел бы
 * подсвеченной чужую вкладку.
 */
function screenLocation(location: Location): Location {
  return (
    (location.state as BackgroundState | null)?.backgroundLocation ?? location
  );
}

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const didHandleStartParam = useRef(false);
  const launchParams = useLaunchParams(true);
  const startParam = launchParams.tgWebAppStartParam;
  // Нативная кнопка «назад» и её видимость — по РЕАЛЬНОМУ адресу: пока
  // открыта шторка, Back обязан её закрыть, а не считаться «корнем».
  const isRoot = ROOT_ROUTES.has(location.pathname);
  const screen = screenLocation(location);

  // P2 list-perf: скролл списка по ключу маршрута — Back из route-модалки
  // возвращает на место списка. State-модалки (handleModalBack ниже)
  // локацию не меняют, хук их не трогает.
  //
  // Ключ — адрес ЭКРАНА (фон под шторкой): иначе открытие деталей считалось
  // бы переходом на другую страницу и сбрасывало скролл фонового списка.
  useScrollRestore(routeScrollKey(screen.pathname, screen.search));

  // Нижний бар — всегда табы. Контекстных CTA в баре больше нет:
  // «Опубликовать» и «Забронировать» живут инлайн в своих формах.

  /**
   * Общий назад для нативного BackButton: сначала верхняя
   * state-модалка, затем история, затем fallback (create — в /bookings).
   */
  const goBack = useCallback(() => {
    // Верхняя state-модалка (FeedbackModal) перехватывает Back первой.
    if (handleModalBack()) return;
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else if (location.pathname === "/trips/my/new")
      navigate("/bookings", { replace: true });
    else navigate("/", { replace: true });
  }, [navigate, location.pathname]);

  useEffect(() => {
    // Hardening вне Telegram: прямые onClick/offClick бросают исключение,
    // если метод недоступен, — подписываемся через ifAvailable (тот же
    // приём, что settingsButton в useSettingsButton).
    backButton.onClick.ifAvailable(goBack);
    return () => {
      backButton.offClick.ifAvailable(goBack);
    };
  }, [goBack]);

  useEffect(() => {
    if (isRoot) backButton.hide.ifAvailable();
    else backButton.show.ifAvailable();
  }, [isRoot]);

  // Нативная кнопка настроек. ПРАВИЛО: кнопка нужна там, где НЕТ кнопки
  // «назад» и есть таббар, то есть на корневых маршрутах. `isRoot` ровно
  // это и значит — см. `useEffect` выше, где на корневых маршрутах
  // backButton прячется.
  //
  // Не-корневые маршруты делятся на два вида, и кнопка там лишняя:
  // поддерево профиля (`/profile/history|edit|support|reports|ride-requests`,
  // `/vehicle`) — переход вёл бы на родителя, и экранный «назад» тут
  // уместнее; углублённые сценарии (`/trips/:id`, `/trips/my/new`,
  // `/reviews`) — сфокусированная задача с возвратом назад.
  //
  // Окно создания заявки (`RideRequestCreateModal`) роутом не стало: Back
  // перехватывает `useModalBack`, фон у окна тот, где его открыли.
  //
  // `/profile` исключён отдельно: тап привёл бы на тот же экран.
  const openProfile = useCallback(() => navigate("/profile"), [navigate]);
  useSettingsButton(openProfile, isRoot && location.pathname !== "/profile");

  // Бейдж непрочитанных — лёгкий счётчик (GET /notifications/unread-count),
  // а не первая страница inbox: таб не тянет полную ленту ради числа.
  // Имя/анонс бейджа не меняются — тот же unreadCount проп в AppBottomBar.
  //
  // Здесь `?? 0` остаётся осознанно, в отличие от кнопки «Прочитать все»
  // (N-02): `TabsBar` рисует бейдж только при `unreadCount > 0`, то есть
  // при сбое бейдж просто отсутствует. Отсутствие бейджа не утверждает
  // «непрочитанных нет» — в отличие от aria-label, который именно утверждал
  // и поэтому врал. Придумывать бейдж «?» ради согласованности значило бы
  // показать пользователю выдуманное число.
  const unreadCountQuery = useUnreadCountQuery();
  const unreadCount = unreadCountQuery.data ?? 0;

  useEffect(() => {
    if (didHandleStartParam.current) return;
    // resolveStartParamRoute: известный токен → маршрут раздела/поездки,
    // неизвестный — безопасный fallback на /trips, пустого нет (null).
    const target = resolveStartParamRoute(startParam);
    if (!target) return;
    didHandleStartParam.current = true;
    navigate(target, { replace: true });
  }, [navigate, startParam]);

  const activeTab: AppTabId =
    screen.pathname === "/"
      ? "home"
      : screen.pathname.startsWith("/bookings") ||
          screen.pathname.startsWith("/trips/my")
        ? "trips"
        : screen.pathname.startsWith("/notifications")
          ? "notifications"
          : screen.pathname.startsWith("/trips")
            ? "search"
            : "profile";

  const go = (to: string) => {
    navigate(to);
  };

  const headerTitle = HEADER_TITLE_RULES.find(([match]) =>
    match(screen.pathname),
  )?.[1];

  return (
    <AppShell
      header={<NavHeader title={headerTitle} />}
      footer={
        <AppBottomBar
          activeTab={activeTab}
          onSelect={go}
          unreadCount={unreadCount}
        />
      }
    >
      {/* Провайдер шторки профиля другого человека — одна шторка на всё
          приложение, состояние живёт выше Outlet и переживает смену
          маршрута (открыл из «Поиска», ушёл в детали — шторка осталась). */}
      <UserProfileProvider>
        {/* Route-fade без motion: CSS-анимация вместо motion/react (−39 KiB
            gzip из initial-бандла). Ключ — только pathname: смена query-string
            не должна перемонтировать страницу (скелетоны, потеря
            скролла). Уважение reduced-motion — класс route-fade
            (AppShell.module.css). */}
        <div key={screen.pathname} className={ROUTE_FADE_CLASS}>
          <Outlet />
        </div>
      </UserProfileProvider>
    </AppShell>
  );
}

/**
 * Таблица экранов приложения — одна на два прохода роутера.
 *
 * `<Routes location>` умеет рендерить маршрут по ЧУЖОМУ адресу; этим
 * пользуется route-шторка: основной проход рисует экран-фон, второй —
 * саму шторку. Разметка одна, поэтому экраны не дублируются.
 */
function AppRoutes({ location }: { location?: Location }) {
  return (
    <Routes location={location}>
      <Route element={<Shell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/trips" element={<SearchPage />} />
        <Route path="/trips/:tripId" element={<TripDetailsRoute />} />
        <Route path="/trips/my" element={<Navigate to="/bookings" replace />} />
        <Route
          path="/trips/my/:tripId/requests"
          element={<TripRequestsRoute />}
        />
        <Route path="/trips/my/new" element={<CreateTripPage />} />
        <Route path="/bookings" element={<TripPage />} />
        <Route
          path="/bookings/history"
          element={<Navigate to="/profile/history" replace />}
        />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/history" element={<TripHistoryPage />} />
        <Route
          path="/profile/ride-requests"
          element={<RideRequestHistoryPage />}
        />
        <Route path="/profile/edit" element={<EditProfileRoute />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile/support" element={<SupportPage />} />
        <Route path="/profile/reports" element={<ReportsPage />} />
        <Route path="/vehicle" element={<VehicleRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * Роутер приложения.
 *
 * Два прохода, а не один: если адрес пришёл со `state.backgroundLocation`
 * (так делает `useOpenTrip`), первый проход рисует экран-ФОН по прошлому
 * адресу, второй — шторку деталей поверх него. Без этого фоном всегда
 * оказывался «Поиск», и тап по уведомлению сначала показывал чужой экран,
 * а уже потом выезжали детали.
 *
 * Cold start по ссылке `/trips/:id` (state нет) идёт прежним путём:
 * `TripDetailsRoute` рисует фоном «Поиск» — другой страницы у пользователя
 * в этот момент не существует.
 */
export function AppRouter() {
  return (
    <HashRouter>
      <RoutesWithBackground />
    </HashRouter>
  );
}

export function RoutesWithBackground() {
  const location = useLocation();
  const background = (location.state as BackgroundState | null)
    ?.backgroundLocation;

  return (
    <>
      <AppRoutes location={background} />
      {background ? (
        <Routes location={location}>
          <Route path="/trips/:tripId" element={<TripDetailsSheet />} />
        </Routes>
      ) : null}
    </>
  );
}
