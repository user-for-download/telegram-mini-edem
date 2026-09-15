import { useEffect } from "react";
import { register, type BottomBarAction } from "@/utils/bottomBarRegistry";

/**
 * Тонкий хук над реестром бара: регистрация на mount, снятие на unmount
 * (cleanup эффекта — нет «призрачной» кнопки), null — страница без
 * действия. Зависимости по полям, а не по объекту: перерегистрация при
 * изменении label/onSubmit/loading/disabled держит в реестре живое
 * состояние, а не снапшот на момент mount.
 */
export function useBottomBarAction(action: BottomBarAction | null): void {
  useEffect(() => {
    if (!action) return;
    return register(action);
  }, [action?.label, action?.onSubmit, action?.loading, action?.disabled]);
}
