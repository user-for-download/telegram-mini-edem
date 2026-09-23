import { Modal } from "@telegram-apps/telegram-ui";
import { useNavigate } from "react-router-dom";
import { SearchPage } from "@/pages/Search/SearchPage";
import { TripDetailsPage } from "@/pages/TripDetails/TripDetailsPage";
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import { SheetBody } from "@/ui/SheetBody";

/**
 * Детали поездки — route-backed шторка поверх «Поиска»;
 * роут /trips/:tripId остаётся источником правды ради диплинков).
 */
export function TripDetailsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Имя диалога + видимый заголовок на base: tgui Modal.Header рисует
  // текст только на iOS.
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Детали поездки</Modal.Header>}
      aria-labelledby={titleId}
    >
      <SheetBody>
        <SheetTitle titleId={titleId}>Детали поездки</SheetTitle>
        <TripDetailsPage />
      </SheetBody>
    </Modal>
  );
}

/**
 * Роут /trips/:tripId: фон — скрытый «Поиск», поверх — настоящая шторка.
 * Контент тестируется через TripDetailsPage (портал Modal в renderToString
 * не попадает). Закрытие — назад по истории, иначе fallback на /trips.
 */
export function TripDetailsRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/trips", { replace: true });
  };
  return (
    <>
      <div aria-hidden hidden>
        <SearchPage />
      </div>
      <TripDetailsModal open onClose={close} />
    </>
  );
}
