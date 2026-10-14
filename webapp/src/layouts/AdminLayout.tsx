import { Link, Outlet } from "@tanstack/react-router";
import {
  CalendarCheck,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MapPin,
  MessageSquare,
  Flag,
  Route,
  Settings,
  Users,
} from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
import { adminLogout } from "@/features/auth";

// Подписи навигации — по-русски, как и заголовки страниц (audit: смешанные
// EN/RU-подписи в русской панели). aria-label ниже = та же подпись.
const navItems = [
  { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
  { to: "/users", label: "Пользователи", icon: Users },
  { to: "/trips", label: "Поездки", icon: Route },
  { to: "/bookings", label: "Брони", icon: CalendarCheck },
  { to: "/reviews", label: "Отзывы", icon: MessageSquare },
  { to: "/feedback", label: "Обратная связь", icon: LifeBuoy },
  { to: "/reports", label: "Жалобы", icon: Flag },
  { to: "/cities", label: "Города", icon: MapPin },
  { to: "/settings", label: "Настройки", icon: Settings },
] as const;

const navLinkClasses =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors";

/**
 * Выход: бэкенд очищает httpOnly cookie, затем полная перезагрузка
 * на /login (сброс кэшей запросов и свежая проверка сессии).
 */
async function handleLogout() {
  try {
    await adminLogout();
  } finally {
    window.location.assign("/login");
  }
}

export function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-16 shrink-0 flex-col border-r border-border md:w-56">
        <div className="flex h-14 items-center border-b border-border px-4 text-sm font-semibold">
          <span className="hidden md:inline">Edem Admin</span>
          <span className="md:hidden" aria-label="Edem Admin">EA</span>
        </div>
        <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1 p-3">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`${navLinkClasses} text-muted-foreground hover:bg-accent hover:text-accent-foreground`}
              activeProps={{
                className: `${navLinkClasses} bg-accent font-medium text-accent-foreground`,
              }}
              aria-label={item.label}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <button
            type="button"
            aria-label="Выйти из панели администратора"
            onClick={handleLogout}
            className={`${navLinkClasses} w-full text-muted-foreground hover:bg-accent hover:text-accent-foreground`}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden md:inline">Выйти</span>
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
