import {
  TabsBar,
  type AppTabId,
  type TabsBarProps,
} from "@/components/TabsBar/TabsBar";

// Совместимость: роутер и тесты используют TabsVariant из этого модуля.
export type { AppTabId, TabsBarProps };
export const TabsVariant = TabsBar;
export type { TabsBarProps as AppBottomBarProps };
