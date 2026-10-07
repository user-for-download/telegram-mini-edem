// telegram-app/src/components/Trip/useMatchingTripCheck.ts
// Предупреждение перед публикацией заявки: под введённые маршрут и окно
// уже есть активные поездки — спрашиваем, открыть ли одну вместо заявки.
//
// Диалог ИНФОРМИРУЮЩИЙ, а не блокирующий (решение владельца): согласие —
// переход в карточку поездки и заявка НЕ создаётся, отказ и «спросить
// нечем» — заявка создаётся ровно как до проверки. Поэтому подтверждение
// живёт в helpers/tgConfirm (три уровня, финальный фолбэк — «согласия
// нет»), а решение «идти или не идти» — здесь.
import { useCallback } from "react";
import { tgConfirm } from "@/helpers/tgConfirm";
import {
  findMatchingTrip,
  matchingTripMessage,
  tripCardRoute,
  type RouteWindowDraft,
} from "./matchingTripsSearch";

/**
 * Проверка перед публикацией: true — заявку публиковать, false — пользователь
 * ушёл смотреть поездку вместо неё.
 *
 * `onNavigate` вне зависимостей хука нет: переход — инъекция (хост окна даёт
 * `navigate`), поэтому форма тестируется без роутера.
 */
export function useMatchingTripCheck(
  onNavigate: (route: string) => void,
): (draft: RouteWindowDraft, routeLabel: string) => Promise<boolean> {
  return useCallback(
    async (draft, routeLabel) => {
      const found = await findMatchingTrip(draft);
      if (found === null) return true;
      const confirmed = await tgConfirm(
        matchingTripMessage(routeLabel, found.total),
      );
      if (!confirmed) return true;
      onNavigate(tripCardRoute(found.trip.id));
      return false;
    },
    [onNavigate],
  );
}
