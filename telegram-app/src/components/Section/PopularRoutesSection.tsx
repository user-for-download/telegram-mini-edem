import { IconContainer } from "@telegram-apps/telegram-ui";
import { Route, ChevronRight } from "lucide-react";
import { Cell } from "@/ui/Cell";
import { Section } from "@/ui/Section";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";
import { useAllCitiesQuery } from "@/queries/useAllCities";

interface PopularRoutesSectionProps {
  /** id городов справочника, не имена: поиск фильтрует по id. */
  onSelect: (fromCityId: string, toCityId: string) => void;
}

/**
 * Популярные направления — вертикальный Cell-список, тап подставляет
 * маршрут в поиск. Счётчика поездок нет осознанно: честного числа
 * (сколько активных поездок по направлению) у фронта нет, а заглушка
 * «0» вводила бы в заблуждение сильнее, чем отсутствие бейджа.
 */
export function PopularRoutesSection({ onSelect }: PopularRoutesSectionProps) {
  const cities = useAllCitiesQuery();
  // POPULAR_ROUTES хранит ИМЕНА, а наружу уходят id. Резолвим здесь: типы
  // у строк совпадают, поэтому передать имя в параметр-id компилятор не
  // помешает — «скомпилировалось» не значит «правильно».
  const byName = new Map((cities.data ?? []).map((city) => [city.name, city.id]));

  return (
    // Без headingLevel="h1": имя главной — у самой страницы
    // (VisuallyHidden h1 в HomePage), а не у секции.
    <Section header="Популярные направления">
      {POPULAR_ROUTES.map((route) => (
        <Cell
          key={`${route.from}-${route.to}`}
          // Нативная кнопка обязательна (фасад, реестр #12): без
          // Component="button" строка не фокусируется Tab'ом и не
          // опознаётся скринридером как кнопка. `Component="button"`
          // раскладку не ломает: сброс AS_BUTTON в ui/Cell даёт для
          // кнопки и div идентичный результат.
          Component="button"
          type="button"
          onClick={() => {
            const fromCityId = byName.get(route.from);
            const toCityId = byName.get(route.to);
            // Города нет в справочнике — тап не ведёт в поиск с молчаливым
            // пресетом: id неоткуда взять, а подставить имя значило бы вернуть
            // неоднозначный поиск по подстроке.
            if (!fromCityId || !toCityId) return;
            onSelect(fromCityId, toCityId);
          }}
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
