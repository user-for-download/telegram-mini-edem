import { useNavigate } from "react-router-dom";
import { tripIdFromPath, useOpenTrip } from "@/hooks/useOpenTrip";
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
 *
 * Хост ещё и единственный, кто умеет переходить: форма не знает роутера,
 * а предпроверка «уже есть поездки» просит открыть найденную карточку.
 * Окно закрываем ПЕРЕД переходом (оно осталось бы висеть поверх карточки),
 * и push, а не replace: «назад» возвращает на страницу, откуда открыли.
 */
export function RideRequestCreateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const openTrip = useOpenTrip();

  // Фокус, Esc и Tab-trap — нативные (Radix FocusScope + onOpenChange);
  // свой role=dialog не добавляем — vaul уже рендерит dialog (двойной анонс).
  // Имя диалога + видимый заголовок на base: tgui Modal.Header рисует
  // текст только на iOS.
  return (
    <Sheet open={open} onClose={onClose} title="Ищу попутку">
      <OfflineBanner />
      <RideRequestCreateForm
        onNavigate={(route) => {
          onClose();
          // Найденная поездка — тоже шторка поверх текущего экрана:
          // иначе под ней отрисовывался бы «Поиск» и переход выглядел
          // как прыжок на чужую вкладку.
          const tripId = tripIdFromPath(route);
          if (tripId) {
            openTrip(tripId);
            return;
          }
          navigate(route);
        }}
      />
    </Sheet>
  );
}
