import { useEffect } from "react";
import { swipeBehavior } from "@tma.js/sdk-react";

/**
 * Пока компонент смонтирован, вертикальный свайп вниз отключён: на экранах
 * с формами (и внутри шторок) он иначе сворачивает или закрывает мини-апп
 * прямо во время скролла. Cleanup возвращает поведение клиента.
 *
 * SSR-safe: эффекты в renderToString не выполняются. `.ifAvailable()`
 * страхует старые клиенты и mock-окружение (Mini Apps v7.7+).
 */
export function useDisableVerticalSwipe(): void {
  useEffect(() => {
    swipeBehavior.disableVertical.ifAvailable();
    return () => {
      swipeBehavior.enableVertical.ifAvailable();
    };
  }, []);
}
