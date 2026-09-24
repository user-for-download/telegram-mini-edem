import { useNavigate } from "react-router-dom";
import { Sheet } from "@/ui/Sheet";
import { SearchPage } from "@/pages/Search/SearchPage";
import { TripDetailsPage } from "@/pages/TripDetails/TripDetailsPage";

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
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Детали поездки"
    >
      <TripDetailsPage />
    </Sheet>
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
