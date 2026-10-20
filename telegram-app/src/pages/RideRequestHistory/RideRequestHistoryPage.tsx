import { useState } from "react";
import { VisuallyHidden } from "@telegram-apps/telegram-ui";
import { RideRequestCreateModal } from "@/components/Trip/RideRequestCreateModal";
import { RideRequestsList } from "@/components/Trip/RideRequestsList";
import { Page } from "@/ui/Page";
import { useModalBack } from "@/utils/modalBack";
import { haptic } from "@/utils/haptics";

/**
 * История запросов на попутку — отдельная страница `/profile/ride-requests`
 * (пункт меню профиля рядом с «Историей поездок»).
 *
 * Страница — только история. Создание живёт на главной («Ищу попутку»), а
 * здесь остаётся единственной точкой входа в пустом состоянии — чтобы экран
 * без заявок не был тупиком. Раньше сверху стояла отдельная секция «Нужен
 * попутчик» с primary-кнопкой: она дублировала главную и отодвигала историю.
 *
 * Список — строки `Cell`: тап открывает шторку управления (статус,
 * пауза/возобновление, правка, удаление). Back закрывает окно создания через
 * `useModalBack` (стек state-модалок), а не навигацией: окно не роут, фон у
 * него тот, где открыли.
 *
 * a11y: имя экрана — скрытый h1 (NavHeader помечен aria-hidden), секция
 * «Мои заявки» даёт h2; строки — нативные элементы с тап-таргетом ≥44px.
 */
export function RideRequestHistoryPage() {
  const [createOpen, setCreateOpen] = useState(false);
  useModalBack(() => setCreateOpen(false), createOpen);

  const openCreate = () => {
    haptic.light();
    setCreateOpen(true);
  };

  return (
    <>
      <Page>
        <VisuallyHidden Component="h1">История запросов</VisuallyHidden>
        <RideRequestsList onCreate={openCreate} />
      </Page>
      <RideRequestCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}
