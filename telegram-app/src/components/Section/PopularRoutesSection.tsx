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
  const cities = useAllCitiesQuery();
  // POPULAR_ROUTES хранит ИМЕНА (так их и писали в cities-data), а наружу
  // уходят id. Резолвим здесь: типы у строк совпадают, поэтому передать имя
  // в параметр, означающий id, компилятор не помешал бы — «всё скомпилировалось»
  // не значит «правильно». Замер 2026-10-03 поймал именно это: в URL уезжало
  // `fromCityId=Вологда`, и оба селекта на поиске схлопывались на один город.
  const byName = new Map((cities.data ?? []).map((city) => [city.name, city.id]));

  return (
    <Section header="Популярные направления" headingLevel="h1">
      {POPULAR_ROUTES.map((route) => (
        <Cell
          key={`${route.from}-${route.to}`}
          // Нативная кнопка — обязательна (фасад, реестр #12). Без
          // Component="button" кит рендерит div: строка не фокусируется
          // Tab'ом и не опознаётся скринридером как кнопка. Замер ДО правки
          // (2026-10-03): 5 строк, tag=DIV, role=null, tabindex=null,
          // focusable=false, фокусируемых строк на секции 0 — то есть все
          // «популярные направления» были доступны только мышью.
          //
          // Ложного опасения нет: утверждение «Component="button" ломает
          // раскладку Cell (UA-стили кнопки)» не подтвердилось — сброс
          // AS_BUTTON в ui/Cell даёт для кнопки и div ИДЕНТИЧНЫЙ результат
          // (замер на /profile: 16px -apple-system, appearance none,
          // box-sizing border-box, display flex, бокс 356x80, без переполнения).
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
