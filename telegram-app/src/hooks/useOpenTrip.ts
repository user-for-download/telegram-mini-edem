import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Форма адреса деталей: `/trips/<id>` (id может быть и легаси-строкой). */
export const TRIP_DETAILS_PATH = /^\/trips\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * id поездки из адреса деталей или null для любого другого экрана.
 *
 * Нужен точкам входа, которые ведут не только в детали (уведомление может
 * вести и в «Отзывы», и в «Мои обращения»): фон-шторку ставим только тогда,
 * когда цель — действительно детали поездки.
 */
export function tripIdFromPath(path: string): string | null {
  const match = TRIP_DETAILS_PATH.exec(path);
  const id = match?.[1];
  // `/trips/my` — не поездка, а раздел «Мои поездки» (redirect на /bookings
  // и поддерево /trips/my/*). Ловить его как id нельзя.
  if (!id || id === "my") return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/**
 * Открыть детали поездки ШТОРКОЙ ПОВЕРХ текущего экрана.
 *
 * Детали живут на роуте `/trips/:tripId` (deep link — источник правды), но
 * этот роут сам по себе не знает, откуда пришли. Раньше он всегда рисовал
 * фоном «Поиск», поэтому тап по уведомлению выглядел как «сначала
 * перекинуло на другую вкладку, потом открылись детали»: под медленно
 * выезжающей шторкой успевал отрисоваться и мигнуть чужой экран.
 *
 * Теперь адрес несёт `state.backgroundLocation` — экран, с которого открыли.
 * Роутер рисует по этому адресу прежнюю страницу (она остаётся смонтированной
 * и не теряет скролл), а шторку — отдельным `<Routes>` поверх. Тот же приём
 * работает на главной, в «Поездках» и истории — везде, где есть карточка.
 *
 * Deep link (холодный старт, `/trips/:id` без state) остаётся на прежнем
 * пути: фоном «Поиск» — другой страницы у пользователя просто нет.
 */
export function useOpenTrip() {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (tripId: string, options?: { replace?: boolean }) => {
      navigate(`/trips/${encodeURIComponent(tripId)}`, {
        state: { backgroundLocation: location },
        replace: options?.replace,
      });
    },
    [navigate, location],
  );
}
