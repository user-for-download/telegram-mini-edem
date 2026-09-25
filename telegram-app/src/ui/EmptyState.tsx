import type { ReactNode } from "react";
import { Placeholder } from "@telegram-apps/telegram-ui";

/**
 * Экран-заглушка: заголовок + описание + действие.
 *
 * Тонкая обёртка над китовым `Placeholder` (паттерн ui/Button и ui/Card:
 * контракт кита 1:1, вид не меняется). Это ОДИН компонент на все экраны
 * такого вида — пустые состояния (`QueryState`), терминальные экраны
 * аккаунта (`AccountStatePage`) и промо-блоки («Едете на машине?» на
 * Home): дублей разметки больше нет, а кнопка действия — всегда наш
 * `ui/Button size="m"` (тап-таргет 44px встроен).
 *
 * Тексты. Пустые состояния («нет данных») берутся из единого словаря
 * `ui/emptyStates` (U4): экраны передают `EMPTY_STATES.<key>.*`,
 * литералы для них в экранах запрещены. В СЛОВАРЬ намеренно НЕ входят
 * учётные/маркетинговые тексты — они передаются литералом: баны и
 * удаление (AuthGate, AccountStatePage), онбординг (Onboarding) и
 * промо-CTA Home (см. комментарий в emptyStates.ts, «Граница»).
 * Сами формулировки НЕ меняем: SSR-тесты ищут строки.
 *
 * НЕ покрывает: loading-спиннеры и error-retry (это QueryState/Loading),
 *  досье пассажира (там Placeholder несёт Breadcrumbs-описание —
 *  другая роль), Onboarding-приветствие (там VisuallyHidden-заголовок
 *  для a11y — другая роль).
 */
export function EmptyState({
  header,
  description,
  action,
  children,
}: {
  header: string;
  description?: string;
  /** Кнопка действия (обычно ui/Button size=\"m\"). */
  action?: ReactNode;
  /**
   * Слот под заголовком (1:1 слоту китового Placeholder). Нужен
   * композитным экранам, которые обязаны пояснить «почему пусто» отдельной
   * строкой — например, оффлайн-подсказка в TripRequestsModal.
   */
  children?: ReactNode;
}) {
  return (
    <Placeholder header={header} description={description} action={action}>
      {children}
    </Placeholder>
  );
}
