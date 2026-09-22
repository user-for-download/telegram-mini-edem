import { useAppRootContext } from "@telegram-apps/telegram-ui/dist/hooks/useAppRootContext";

/**
 * Платформа tgui (ios/base): зеркало внутреннего хука кита
 * (dist/hooks/usePlatform.js — не экспортируется из индекса пакета;
 * у пакета нет `exports`-map, поэтому глубокий импорт резолвится).
 * Проверено на @telegram-apps/telegram-ui 2.1.13: при обновлении кита
 * сверить dist/hooks/usePlatform.js и dist/hooks/useAppRootContext.js.
 * Fallback 'base' — как в ките.
 */
export function usePlatform(): "base" | "ios" {
  const context = useAppRootContext();
  return context.platform === "ios" ? "ios" : "base";
}
