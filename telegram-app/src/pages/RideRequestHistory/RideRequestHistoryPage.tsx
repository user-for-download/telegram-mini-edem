import { useState } from "react";
import { VisuallyHidden } from "@telegram-apps/telegram-ui";
import { PlusCircle } from "lucide-react";
import { RideRequestCreateModal } from "@/components/Trip/RideRequestCreateModal";
import { RideRequestsList } from "@/components/Trip/RideRequestsList";
import { Button } from "@/ui/Button";
import { Page } from "@/ui/Page";
import { Section } from "@/ui/Section";
import { SectionBody } from "@/ui/SectionBody";
import { useModalBack } from "@/utils/modalBack";
import { haptic } from "@/utils/haptics";

/**
 * История запросов на попутку — отдельная страница `/profile/ride-requests`
 * (пункт меню профиля рядом с «Историей поездок»).
 *
 * Раньше список жил в шторке «Ищу попутку» вместе с формой создания, а точка
 * входа была одна — CTA на главной. Разделение по назначению: списком
 * заявок (статусы, пауза, редактирование, отмена) управляют на странице, а
 * создание — короткое действие, которому достаточно окна
 * (`RideRequestCreateModal`).
 *
 * Back закрывает окно через `useModalBack` (стек state-модалок), а не
 * навигацией: окно не роут, фон у него тот, где открыли.
 *
 * a11y: имя экрана — скрытый h1 (NavHeader помечен aria-hidden), секция даёт
 * h2; кнопка и карточки — нативные элементы с MIN_TARGET.
 */
export function RideRequestHistoryPage() {
  const [createOpen, setCreateOpen] = useState(false);
  useModalBack(() => setCreateOpen(false), createOpen);

  return (
    <>
      <Page>
        <VisuallyHidden Component="h1">История запросов</VisuallyHidden>
        <Section header="Нужен попутчик">
          <SectionBody>
            <Button
              stretched
              size="m"
              before={<PlusCircle size={16} />}
              onClick={() => {
                haptic.light();
                setCreateOpen(true);
              }}
            >
              Создать запрос
            </Button>
          </SectionBody>
        </Section>
        <Section header="Мои заявки">
          <SectionBody>
            <RideRequestsList />
          </SectionBody>
        </Section>
      </Page>
      <RideRequestCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}