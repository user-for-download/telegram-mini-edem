import {
  TabsBar,
  type AppTabId,
  type TabsBarProps,
} from "@/components/TabsBar/TabsBar";
import styles from "./AppBottomBar.module.css";

export type { AppTabId, TabsBarProps };
export type AppBottomBarProps = TabsBarProps;

/**
 * Нижний бар приложения: nav-landmark «Основные разделы» + нативный
 * Tabbar (стили пилюли — Tabbar.module.css у TabsBar, здесь только
 * сброс nav). Всегда табы, контекстных CTA в баре нет:
 * «Опубликовать» и «Забронировать» живут инлайн в своих формах.
 * Бейдж непрочитанных — пропом (счётчик считает роутер из кэша inbox).
 */
export function AppBottomBar({
  activeTab,
  onSelect,
  unreadCount = 0,
}: TabsBarProps) {
  return (
    <nav aria-label="Основные разделы" className={styles.nav}>
      <TabsBar
        activeTab={activeTab}
        onSelect={onSelect}
        unreadCount={unreadCount}
      />
    </nav>
  );
}
