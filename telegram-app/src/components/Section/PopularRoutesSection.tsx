import { Cell, IconContainer, Section } from "@telegram-apps/telegram-ui";
import { Route } from "lucide-react";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";

interface PopularRoutesSectionProps {
  onSelect: (from: string, to: string) => void;
}

/** Популярные направления — вертикальный Cell-список, тап подставляет маршрут в поиск. */
export function PopularRoutesSection({ onSelect }: PopularRoutesSectionProps) {
  return (
    <Section header="Популярные направления">
      {POPULAR_ROUTES.map((route) => (
        <Cell
          key={`${route.from}-${route.to}`}
          type="button"
          onClick={() => onSelect(route.from, route.to)}
          before={
            <IconContainer>
              <Route size={22} />
            </IconContainer>
          }
        >
          {route.from} → {route.to}
        </Cell>
      ))}
    </Section>
  );
}
