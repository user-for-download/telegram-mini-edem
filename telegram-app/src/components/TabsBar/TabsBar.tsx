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
 * Нижний док как у официального клиента (TabBarUI/TabBarContollerNode +
 * TabBarComponent): пилюля 64px на 4 раздела + detached-круг поиска 64px
 * (barHeight 56 + innerInset 2x4, зазор 8px). TGUI Tabbar всегда рендерит
 * свой FixedLayout, поэтому ряд — свой fixed-контейнер, а Tabbar.Item
 * используются standalone (это обычные кнопки, fixed им не нужен).
 * Иконки 28px uniform stroke 2, активный — link_color (синий Telegram),
 * неактивные — text_color. Бейдж непрочитанных — пропом.
 * a11y: nav-landmark «Разделы», счётчик дублируем в aria-label кнопки.
 */
export function TabsBar({
  activeTab,
  onSelect,
  unreadCount = 0,
}: TabsBarProps) {
  const searchSelected = activeTab === "search";

  return (
    <div className={styles.dock}>
      <nav aria-label="Разделы" className={styles.tabbar}>
        {TABS.map(({ key, text, to, Icon }) => {
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
                <Icon size={28} strokeWidth={2} />
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
      </nav>
      <button
        type="button"
        aria-label="Поиск"
        className={`${styles.search} ${searchSelected ? styles.searchSelected : ""}`}
        onClick={() => go(activeTab, "search", "/trips", onSelect)}
      >
        <Search size={28} strokeWidth={2} />
      </button>
    </div>
  );
}
