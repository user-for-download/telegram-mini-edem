import { useCallback, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  backButton,
  useLaunchParams,
} from "@telegram-apps/sdk-react";
import { AppHeader } from "@/components/AppHeader";
import { AppTabbar, type AppTabId } from "@/components/AppTabbar";
import { useSettingsButton } from "@/hooks/useSettingsButton";
import { useScrollRestore, routeScrollKey } from "@/hooks/useScrollRestore";
import { handleModalBack } from "@/utils/modalBack";
import { HomePage } from "@/pages/HomePage";
import { SearchPage } from "@/pages/SearchPage";
import { TripDetailsRoute } from "@/components/TripDetailsModal";
import { CreateTripRoute } from "@/components/CreateTripModal";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { VehicleRoute } from "@/components/VehicleModal";
import { TripsPage } from "@/pages/TripsPage";
import { RideRequestsRoute } from "@/components/RideRequestsModal";
import { TripRequestsRoute } from "@/components/TripRequestsModal";
import { ProfilePage } from "@/pages/ProfilePage";
import { EditProfileRoute } from "@/components/EditProfileModal";
import { useNotificationsInboxQuery } from "@/queries/useNotificationsQuery";
import { ReviewsRoute } from "@/components/ReviewsModal";
import { SettingsRoute } from "@/components/SettingsModal";
import { SupportRoute } from "@/components/SupportModal";
import { ReportsRoute } from "@/components/ReportsModal";
import {
  parseTripStartParam,
  resolveStartParamRoute,
} from "@/router/deepLinks";

export { parseTripStartParam };

const ROOT_ROUTES = new Set(["/", "/trips", "/bookings", "/notifications", "/profile"]);

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

  useEffect(() => {
    const handleBack = () => {
      // Верхняя state-модалка (FeedbackModal) перехватывает Back первой.
      if (handleModalBack()) return;
      const historyIndex = window.history.state?.idx;
      if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
      else navigate("/", { replace: true });
    };
    backButton.onClick(handleBack);
    return () => backButton.offClick(handleBack);
  }, [navigate]);

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

  const activeTab: AppTabId = location.pathname === "/"
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
    <div className="AppShell">
      {isRoot && <AppHeader />}
      <main className="AppShell__content" tabIndex={-1}>
        <motion.div
          key={location.pathname + location.search}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <Outlet />
        </motion.div>
      </main>
      <nav aria-label="Основные разделы">
        <AppTabbar activeTab={activeTab} onSelect={go} unreadCount={unreadCount} />
      </nav>
    </div>
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
          <Route path="/trips/my" element={<Navigate to="/bookings?segment=driver" replace />} />
          <Route path="/trips/my/:tripId/requests" element={<TripRequestsRoute />} />
          <Route path="/trips/my/new" element={<CreateTripRoute />} />
          <Route path="/bookings" element={<TripsPage />} />
          <Route path="/bookings/history" element={<Navigate to="/bookings?segment=history" replace />} />
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
