import { IconContainer } from "@telegram-apps/telegram-ui";
import { Route, ChevronRight } from "lucide-react";
import { Cell } from "@/ui/Cell";
import { Section } from "@/ui/Section";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";
import { useAllCitiesQuery } from "@/queries/useAllCities";

interface PopularRoutesSectionProps {
  /**
   * id городов справочника, не имена: дальше поиск фильтрует по id
   * (решение владельца 2026-10-03).
   */
  onSelect: (fromCityId: string, toCityId: string) => void;
}

/**
 * Популярные направления — вертикальный Cell-список, тап подставляет
 * маршрут в поиск. Счётчика поездок нет осознанно: честного числа
 * (сколько активных поездок по направлению) у фронта нет, а заглушка
 * «0» вводила бы в заблуждение сильнее, чем отсутствие бейджа.
 */
export function PopularRoutesSection({ onSelect }: PopularRoutesSectionProps) {
  return (
    <Section header="Популярные направления" headingLevel="h1">
      {POPULAR_ROUTES.map((route) => (
        <Cell
          key={`${route.from}-${route.to}`}
          type="button"
          onClick={() => onSelect(route.from, route.to)}
          after={<ChevronRight />}
          before={
            <IconContainer>
              <Route aria-hidden />
            </IconContainer>
          }
        >
          {route.from} → {route.to}
        </Cell>
      ))}
    </Section>
  );
}
