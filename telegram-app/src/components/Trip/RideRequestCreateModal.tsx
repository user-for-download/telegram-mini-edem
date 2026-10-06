import { OfflineBanner } from "@/components/OfflineBanner";
import { Sheet } from "@/ui/Sheet";
import { RideRequestCreateForm } from "./RideRequestCreateForm";

/**
 * Всплывающее окно создания заявки на попутку.
 *
 * Раньше заявки жили в одной шторке «Ищу попутку» вместе со списком, а сама
 * шторка была route-backed (`/ride-requests`, фон — «Поиск»). Теперь у формы
 * и у списка разные хозяева: форме достаточно окна, списку — отдельной
 * страницы «История запросов» (`/profile/ride-requests`).
 *
 * Окно хост-managed (`open`/`onClose`), Back на хосте — через `useModalBack`:
 * route-обёртка ради одного Back больше не нужна, а фон у окна теперь
 * тот, где его открыли.
 *
 * a11y: нативный telegram-ui Modal (vaul Drawer поверх Radix Dialog) даёт
 * role=dialog + aria-modal, Esc/overlay-закрытие через onOpenChange,
 * focus-trap и возврат фокуса. `OfflineBanner` — обязателен именно здесь:
 * портал шторки перекрывает глобальный баннер (AppConfig), на страницах
 * локальные копии не дублируются.
 */
export function RideRequestCreateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Фокус, Esc и Tab-trap — нативные (Radix FocusScope + onOpenChange);
  // свой role=dialog не добавляем — vaul уже рендерит dialog (двойной анонс).
  // Имя диалога + видимый заголовок на base: tgui Modal.Header рисует
  // текст только на iOS.
  return (
    <Sheet open={open} onClose={onClose} title="Ищу попутку">
      <OfflineBanner />
      <RideRequestCreateForm />
    </Sheet>
  );
}