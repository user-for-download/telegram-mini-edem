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
  { key: "search", text: "Поиск", to: "/trips", Icon: Search },
  {
    key: "notifications",
    text: "Уведомления",
    to: "/notifications",
    Icon: Bell,
  },
  { key: "profile", text: "Профиль", to: "/profile", Icon: User },
] as const;

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
 * Нижний таббар на нативном `Tabbar` кита (внутри — FixedLayout bottom
 * с safe-area). Пять разделов табом, бейдж непрочитанных — пропом.
 * Поиск — центральный акцент: залитый круг button_color, иконка чуть
 * крупнее (30px). Остальные иконки 28px uniform stroke 2, активный —
 * link_color. a11y: nav-landmark «Разделы» держит AppBottomBar, счётчик
 * дублируем в aria-label кнопки.
 */
export function TabsBar({
  activeTab,
  onSelect,
  unreadCount = 0,
}: TabsBarProps) {
  return (
    <Tabbar className={styles.tabbar}>
      {TABS.map(({ key, text, to, Icon }) => {
        const selected = activeTab === key;
        const showBadge = key === "notifications" && unreadCount > 0;
        const isSearch = key === "search";

        return (
          <Tabbar.Item
            key={key}
            selected={selected}
            text={isSearch ? undefined : text}
            aria-label={
              showBadge ? `${text}, непрочитанных: ${unreadCount}` : text
            }
            onClick={() => go(activeTab, key, to, onSelect)}
            className={isSearch ? styles.searchItem : undefined}
          >
            {/* relative-обёртка для позиционирования Badge поверх иконки */}
            <span className={styles.iconWrap}>
              <Icon size={isSearch ? 30 : 28} strokeWidth={2} />
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
