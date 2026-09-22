import { Badge, Tabbar } from "@telegram-apps/telegram-ui";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Bell, Car, Home, Search, User } from "lucide-react";
import styles from "./Tabbar.module.css";

export type AppTabId =
  "home" | "trips" | "notifications" | "search" | "profile";

export interface TabsBarProps {
  activeTab: AppTabId;
  onSelect: (to: string) => void;
  unreadCount?: number;
}

const TABS = [
  { key: "home", text: "Главная", to: "/", Icon: Home },
  { key: "trips", text: "Поездки", to: "/bookings", Icon: Car },
  {
    key: "notifications",
    text: "Уведомления",
    to: "/notifications",
    Icon: Bell,
  },
  { key: "profile", text: "Профиль", to: "/profile", Icon: User },
] as const;

const SEARCH_TAB = {
  key: "search",
  text: "Поиск",
  to: "/trips",
  Icon: Search,
} as const;

function go(
  activeTab: AppTabId,
  key: AppTabId,
  to: string,
  onSelect: (to: string) => void,
) {
  if (activeTab === key) return;
  hapticFeedback.selectionChanged.ifAvailable();
  onSelect(to);
}

/**
 * Нативный Tabbar из @telegram-apps/telegram-ui: все 5 разделов (включая
 * Поиск) в единой панели — как в официальном клиенте Telegram. Стили
 * пилюли — Tabbar.module.css (без Tailwind), safe-area, цвета темы
 * и selected-состояние — нативные. Route-driven: активный таб
 * определяет роутер, компонент только рендерит и отдаёт выбор наружу.
 * Бейдж непрочитанных — пропом (счётчик считает роутер из кэша inbox).
 * a11y: Tabbar.Item не несёт tab-семантики, поэтому счётчик дублируем
 * в aria-label кнопки (иначе скринридер его не объявит).
 */
export function TabsBar({
  activeTab,
  onSelect,
  unreadCount = 0,
}: TabsBarProps) {
  const items = [...TABS, SEARCH_TAB];

  return (
    /* Tabbar сам рендерит FixedLayout (vertical=bottom по умолчанию) —
       своя обёртка не нужна: двойной fixed давал наложение. Пилюля:
       скругление + боковые отступы, снизу — реальный инсет Телеграма
       (env() в WebView равен 0). overflow-hidden чтобы фоны айтемов
       не торчали из скруглённых углов. */
    <Tabbar className={`${styles.fixed} ${styles.tabbar}`}>
      {items.map(({ key, text, to, Icon }) => {
        const selected = activeTab === key;
        const showBadge = key === "notifications" && unreadCount > 0;

        return (
          <Tabbar.Item
            key={key}
            selected={selected}
            text={text}
            aria-label={
              showBadge ? `${text}, непрочитанных: ${unreadCount}` : text
            }
            onClick={() => go(activeTab, key, to, onSelect)}
          >
            {/* relative-обёртка для позиционирования Badge поверх иконки */}
            <span className={styles.iconWrap}>
              <Icon size={28} strokeWidth={selected ? 2.2 : 1.8} />
              {showBadge && (
                <Badge
                  type="number"
                  mode="critical"
                  aria-hidden="true"
                  className={styles.badge}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              )}
            </span>
          </Tabbar.Item>
        );
      })}
    </Tabbar>
  );
}
