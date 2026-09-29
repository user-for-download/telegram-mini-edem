import { useEffect } from "react";
import { closingBehavior } from "@tma.js/sdk-react";

/**
 * Подтверждение закрытия при несохранённых данных (официальная дока:
 * closingBehavior.enableConfirmation пока форма грязная). SSR-safe — эффекты
 * в renderToString не выполняются. Cleanup всегда снимает флаг.
 */
export function useClosingConfirmation(dirty: boolean): void {
  useEffect(() => {
    if (dirty) closingBehavior.enableConfirmation.ifAvailable();
    else closingBehavior.disableConfirmation.ifAvailable();
    return () => {
      closingBehavior.disableConfirmation.ifAvailable();
    };
  }, [dirty]);
}
