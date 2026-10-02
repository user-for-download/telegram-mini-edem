import { useContext } from "react";
import { AppRootContext } from "@telegram-apps/telegram-ui/dist/components/Service/AppRoot/AppRootContext";
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

/**
 * Платформа tgui с фолбэком 'base' вместо исключения.
 *
 * Нужна там, где отсутствие AppRoot — норма, а не ошибка: китовый `Section`
 * вне контекста тоже просто рисуется нейтрально, и вёрстка заголовка секции не
 * должна ронять рендер страницы (изолированные тесты рендерят страницы без
 * AppRoot). Строгий usePlatform оставлен там, где отсутствие AppRoot — реальная
 * поломка (ui/Sheet: без шторки диалог теряется).
 */
export function usePlatformOrBase(): "base" | "ios" {
  const context = useContext(AppRootContext);
  return context?.platform === "ios" ? "ios" : "base";
}
