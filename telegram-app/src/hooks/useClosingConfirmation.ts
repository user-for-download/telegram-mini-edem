import { useEffect } from "react";
import {
  disableClosingConfirmation,
  enableClosingConfirmation,
} from "@telegram-apps/sdk-react";

/**
 * Подтверждение закрытия при несохранённых данных (официальная дока:
 * enableClosingConfirmation пока форма грязная). SSR-safe — эффекты
 * в renderToString не выполняются. Cleanup всегда снимает флаг.
 */
export function useClosingConfirmation(dirty: boolean): void {
  useEffect(() => {
    if (dirty) enableClosingConfirmation.ifAvailable();
    else disableClosingConfirmation.ifAvailable();
    return () => {
      disableClosingConfirmation.ifAvailable();
    };
  }, [dirty]);
}
