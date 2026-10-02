import {
  IconContainer,
  Section,
} from "@telegram-apps/telegram-ui";
import { Route, ChevronRight } from "lucide-react";
import { Cell } from "@/ui/Cell";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";

interface PopularRoutesSectionProps {
  onSelect: (from: string, to: string) => void;
}

/**
 * Популярные направления — вертикальный Cell-список, тап подставляет
 * маршрут в поиск. Счётчика поездок нет осознанно: честного числа
 * (сколько активных поездок по направлению) у фронта нет, а заглушка
 * «0» вводила бы в заблуждение сильнее, чем отсутствие бейджа.
 */
export function PopularRoutesSection({ onSelect }: PopularRoutesSectionProps) {
  return (
    <Section header="Популярные направления">
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
