import { VisuallyHidden } from "@telegram-apps/telegram-ui";
import { RideRequestsList } from "@/components/Trip/RideRequestsList";
import { Page } from "@/ui/Page";

/**
 * История запросов на попутку — отдельная страница `/profile/ride-requests`
 * (пункт меню профиля рядом с «Историей поездок»).
 *
 * Страница — только история, как «История поездок»: ни секции создания, ни
 * кнопки. Создание живёт на главной («Ищу попутку»), управление существующим
 * запросом — в шторке строки. Пустое состояние такое же, как у истории
 * поездок: заголовок экрана в NavHeader, внутри — только «Пока пусто».
 *
 * a11y: имя экрана — скрытый h1 (NavHeader помечен aria-hidden); строки —
 * нативные элементы с тап-таргетом ≥44px.
 */
export function RideRequestHistoryPage() {
  return (
    <Page>
      <VisuallyHidden Component="h1">История запросов</VisuallyHidden>
      <RideRequestsList />
    </Page>
  );
}
