import { useNavigate } from "react-router-dom";
import { Sheet } from "@/ui/Sheet";
import { SearchPage } from "@/pages/Search/SearchPage";
import { TripDetailsPage } from "@/pages/TripDetails/TripDetailsPage";
import { OfflineBanner } from "@/components/OfflineBanner";

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
      variant="flush"
    >
      <OfflineBanner />
      <TripDetailsPage />
    </Sheet>
  );
}

/** Шторка деталей для адреса `/trips/:tripId` + закрытие по истории. */
export function TripDetailsSheet() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/trips", { replace: true });
  };
  return <TripDetailsModal open onClose={close} />;
}

/**
 * DEEP LINK `/trips/:tripId` (холодный старт, ссылка из мессенджера):
 * фон — «Поиск» ОТКРЫТЫМ (как в EditProfileRoute и VehicleRoute), поверх —
 * настоящая шторка; затемнение и перехват указателя даёт китовый Modal.
 * Раньше здесь был `<div aria-hidden hidden>` — он выкидывал фон из дерева
 * доступности и оставлял под шторкой пустоту.
 *
 * Навигация ВНУТРИ приложения идёт другим путём: `useOpenTrip` кладёт в
 * state `backgroundLocation`, и роутер рисует фоном тот экран, откуда
 * пришли (см. AppRouter). Этот компонент остаётся ровно для случая, когда
 * «откуда пришли» не существует — холодного старта по ссылке.
 *
 * Контент тестируется через TripDetailsPage (портал Modal в renderToString
 * не попадает). Закрытие — назад по истории, иначе fallback на /trips.
 */
export function TripDetailsRoute() {
  return (
    <>
      <SearchPage />
      <TripDetailsSheet />
    </>
  );
}
