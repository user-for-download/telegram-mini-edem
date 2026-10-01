import { useEffect } from "react";
import { closingBehavior } from "@tma.js/sdk-react";

/**
 * Подтверждение закрытия при несохранённых данных (официальная дока:
 * closingBehavior.enableConfirmation пока форма грязная). SSR-safe — эффекты
 * в renderToString не выполняются.
 *
 * Счётчик грязных форм, а не флаг: closingBehavior — ГЛОБАЛЬНОЕ
 * состояние клиента, а форм может быть несколько одновременно (например
 * страница формы + шторка внутри неё). Прежний вариант в cleanup всегда
 * звал disableConfirmation, поэтому размонтирование одной грязной формы
 * снимало подтверждение у другой, ещё не сохранённой (B11).
 *
 * Счётчик живёт на уровне модуля (состояние клиента общее), как и сам
 * closingBehavior. Несколько форм включают подтверждение один раз;
 * выключает его последняя из них.
 */
let dirtyForms = 0;

export function useClosingConfirmation(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    dirtyForms += 1;
    if (dirtyForms === 1) {
      closingBehavior.enableConfirmation.ifAvailable();
    }
    return () => {
      dirtyForms = Math.max(0, dirtyForms - 1);
      if (dirtyForms === 0) {
        closingBehavior.disableConfirmation.ifAvailable();
      }
    };
  }, [dirty]);
}

/**
 * Сброс счётчика (тесты, смена пользователя). Клиенту уходит
 * disableConfirmation, чтобы не осталось подтверждения от формы,
 * размонтированной без cleanup.
 */
export function resetClosingConfirmation(): void {
  dirtyForms = 0;
  closingBehavior.disableConfirmation.ifAvailable();
}
