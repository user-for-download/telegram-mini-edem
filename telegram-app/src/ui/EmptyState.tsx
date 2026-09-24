import type { ReactNode } from "react";
import { Placeholder } from "@telegram-apps/telegram-ui";

/**
 * Пустое состояние ленты/формы: заголовок + описание + действие.
 *
 * Тонкая обёртка над китовым `Placeholder` (паттерн ui/Button и ui/Card:
 * контракт кита 1:1, вид не меняется). Даёт одно место, где живёт
 * «пусто»: вместо 20+ прямых `<Placeholder>` с разномастными кнопками —
 * один `EmptyState` с тем же header/description, а кнопка действия —
 * всегда наш `ui/Button size=\"m\"` (тап-таргет 44px встроен).
 *
 * Тексты НЕ меняем: SSR-тесты ищут строки («Пока нет поездок для
 * отзыва», «Поездок не найдено» и др.).
 *
 * НЕ покрывает: loading-спиннеры и error-retry (это QueryState),
 * терминальные экраны вне таб-шелла (AccountStatePage — свой канон
 * центрированной колонки), досье пассажира (там Placeholder несёт
 * Breadcrumbs-описание — другая роль), Onboarding-приветствие
 * (там VisuallyHidden-заголовок для a11y — другая роль).
 */
export function EmptyState({
  header,
  description,
  action,
}: {
  header: string;
  description?: string;
  /** Кнопка действия (обычно ui/Button size=\"m\"). */
  action?: ReactNode;
}) {
  return (
    <Placeholder header={header} description={description} action={action} />
  );
}
