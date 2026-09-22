import { useCallback, useEffect, useRef } from "react";
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { backButton, useLaunchParams } from "@telegram-apps/sdk-react";
import { AppHeader } from "@/components/AppHeader/AppHeader";
import {
  AppBottomBar,
  type AppTabId,
} from "@/components/AppBottomBar/AppBottomBar";
import { AppShell } from "@/components/AppShell/AppShell";
import { useSettingsButton } from "@/hooks/useSettingsButton";
import { useScrollRestore, routeScrollKey } from "@/hooks/useScrollRestore";
import { handleModalBack } from "@/utils/modalBack";
import { ROUTE_FADE_CLASS } from "@/components/AppShell/AppShell";
import { HomePage } from "@/pages/HomePage/HomePage";
import { SearchPage } from "@/pages/Search/SearchPage";
import { TripDetailsRoute } from "@/components/Trip/TripDetailsModal";
import { CreateTripPage } from "@/pages/CreateTrip/CreateTripPage";
import { NotificationsPage } from "@/pages/Notifications/NotificationsPage";
import { VehicleRoute } from "@/components/Profile/VehicleModal";
import { TripPage } from "@/pages/Trip/TripPage";
import { RideRequestsRoute } from "@/components/Trip/RideRequestsModal";
import { TripRequestsRoute } from "@/components/Trip/TripRequestsModal";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import { EditProfileRoute } from "@/components/Profile/EditProfileModal";
import { useNotificationsInboxQuery } from "@/queries/useNotificationsQuery";
import { ReviewsRoute } from "@/components/Profile/ReviewsModal";
import { SettingsRoute } from "@/components/Profile/SettingsModal";
import { SupportRoute } from "@/components/Profile/SupportModal";
import { ReportsRoute } from "@/components/Profile/ReportsModal";
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

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const didHandleStartParam = useRef(false);
  const launchParams = useLaunchParams(true);
  const startParam = launchParams.tgWebAppStartParam;
  const isRoot = ROOT_ROUTES.has(location.pathname);

  // P2 list-perf: скролл списка по ключу маршрута — Back из route-модалки
  // возвращает на место списка. State-модалки (handleModalBack ниже)
  // локацию не меняют, хук их не трогает.
  useScrollRestore(routeScrollKey(location.pathname, location.search));

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
    backButton.onClick(goBack);
    return () => backButton.offClick(goBack);
  }, [goBack]);

  useEffect(() => {
    if (isRoot) backButton.hide.ifAvailable();
    else backButton.show.ifAvailable();
  }, [isRoot]);

  // Нативная кнопка настроек: везде, кроме профиля, ведёт в профиль.
  const openProfile = useCallback(() => navigate("/profile"), [navigate]);
  useSettingsButton(openProfile, isRoot && location.pathname !== "/profile");

  // Бейдж непрочитанных на табе (тот же кэш inbox, что у страницы).
  const inbox = useNotificationsInboxQuery(20);
  const unreadCount = inbox.data?.pages[0]?.unreadCount ?? 0;

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
    location.pathname === "/"
      ? "home"
      : location.pathname.startsWith("/bookings")
        ? "trips"
          : location.pathname.startsWith("/notifications")
            ? "notifications"
            : location.pathname.startsWith("/trips")
              ? "search"
              : "profile";

  const go = (to: string) => {
    navigate(to);
  };

  return (
    <AppShell
      header={isRoot ? <AppHeader /> : undefined}
      footer={
        <AppBottomBar
          activeTab={activeTab}
          onSelect={go}
          unreadCount={unreadCount}
        />
      }
    >
      {/* Route-fade без motion: CSS-анимация вместо motion/react (−39 KiB
          gzip из initial-бандла). Ключ — только pathname: смена query-string
          (?segment=…) не должна перемонтировать страницу (скелетоны, потеря
          скролла). Уважение reduced-motion — класс route-fade
          (AppShell.module.css). */}
      <div key={location.pathname} className={ROUTE_FADE_CLASS}>
        <Outlet />
      </div>
    </AppShell>
  );
}

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/trips" element={<SearchPage />} />
          <Route path="/trips/:tripId" element={<TripDetailsRoute />} />
          <Route
            path="/trips/my"
            element={<Navigate to="/bookings" replace />}
          />
          <Route
            path="/trips/my/:tripId/requests"
            element={<TripRequestsRoute />}
          />
          <Route path="/trips/my/new" element={<CreateTripPage />} />
          <Route path="/bookings" element={<TripPage />} />
          <Route
            path="/bookings/history"
            element={<Navigate to="/bookings?segment=history" replace />}
          />
          <Route path="/ride-requests" element={<RideRequestsRoute />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/edit" element={<EditProfileRoute />} />
          <Route path="/reviews" element={<ReviewsRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile/support" element={<SupportRoute />} />
          <Route path="/profile/reports" element={<ReportsRoute />} />
          <Route path="/vehicle" element={<VehicleRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
