import { OfflineBanner } from "@/components/OfflineBanner";
import type { Report } from "@edem/contracts";
import { Sheet } from "@/ui/Sheet";
import { ComplaintForm } from "./ComplaintForm";

/**
 * Всплывающее окно подачи жалобы.
 *
 * Открывается кнопкой «Подать жалобу» под списком «Мои жалобы» на странице
 * /profile/reports. Хост-managed (`open`/`onClose`): Back перехватывает
 * `useModalBack` на странице, фон — сама страница со списком, который после
 * отправки обновится инвалидацией кэша.
 *
 * Тот же приём, что у формы обращения в поддержку (`FeedbackModal`): форма —
 * в окне, список — на странице.
 *
 * `OfflineBanner` — обязателен именно здесь: портал шторки перекрывает
 * глобальный баннер из AppConfig, на страницах локальные копии не дублируются.
 */
export function ComplaintModal({
  open,
  onClose,
  reports,
}: {
  open: boolean;
  onClose: () => void;
  /** Свои жалобы — хинт «уже отправлено» по этому объекту. */
  reports: Report[];
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Подать жалобу">
      <OfflineBanner />
      <ComplaintForm reports={reports} onSubmitted={onClose} />
    </Sheet>
  );
}
