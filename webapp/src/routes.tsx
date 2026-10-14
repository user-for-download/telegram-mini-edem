import {
  createRootRoute,
  createRoute,
  createRouter,
  isRedirect,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";

import { LoginPage, getAdminSession } from "./features/auth";
import { AdminLayout } from "./layouts/AdminLayout";

const rootRoute = createRootRoute({
  notFoundComponent: NotFound,
});

/**
 * Публичный маршрут: страница входа. Если сессия уже есть —
 * сразу на дашборд, чтобы не показывать форму авторизованному админу.
 */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
  beforeLoad: async () => {
    try {
      const session = await getAdminSession();
      if (session.authenticated) {
        throw redirect({ to: "/dashboard", replace: true });
      }
    } catch (error) {
      // redirect — не ошибка; сетевой сбой оставляем страницу входа.
      if (isRedirect(error)) throw error;
    }
  },
});

/**
 * Pathless layout-роут админки: AdminLayout + проверка сессии.
 * httpOnly cookie недоступен JS, поэтому статус опрашиваем у /auth/session.
 * Сетевой сбой проверки не маскируем под «не авторизован» — пробрасываем.
 */
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "admin",
  component: AdminLayout,
  beforeLoad: async () => {
    const session = await getAdminSession();
    if (!session.authenticated) {
      throw redirect({ to: "/login", replace: true });
    }
  },
});

const indexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/dashboard",
  component: lazyRouteComponent(() => import("./pages/dashboard")),
});

const usersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/users",
  component: lazyRouteComponent(() => import("./pages/users")),
});

const tripsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/trips",
  component: lazyRouteComponent(() => import("./pages/trips")),
});

const bookingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/bookings",
  component: lazyRouteComponent(() => import("./pages/bookings")),
});

const reviewsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/reviews",
  component: lazyRouteComponent(() => import("./pages/reviews")),
});

const feedbackRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/feedback",
  component: lazyRouteComponent(() => import("./pages/feedback")),
});

const reportsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/reports",
  component: lazyRouteComponent(() => import("./pages/reports")),
});

const citiesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/cities",
  component: lazyRouteComponent(() => import("./pages/cities")),
});

const settingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./pages/settings")),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  adminRoute.addChildren([
    indexRoute,
    dashboardRoute,
    usersRoute,
    tripsRoute,
    bookingsRoute,
    reviewsRoute,
    feedbackRoute,
    reportsRoute,
    citiesRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div>
        <h1 className="text-lg font-semibold">Страница не найдена</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Запрошенная страница не существует.
        </p>
      </div>
    </div>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
