import { IconContainer } from "@telegram-apps/telegram-ui";
import { Route, ChevronRight } from "lucide-react";
import { Cell } from "@/ui/Cell";
import { Section } from "@/ui/Section";
import { useRideRequestFeedQuery } from "@/queries/useRideRequestsQuery";
import { dayLabel, moscowDayKey, moscowTimeLabel } from "@/utils/date";
import { plural } from "@/utils/plural";

interface RideRequestFeedSectionProps {
  /** id городов справочника, не имена: поиск фильтрует по id. */
  onSelect: (fromCityId: string, toCityId: string) => void;
}

/**
 * Лента заявок на попутку на главной — «кто ищет попутку».
 *
 * Заявку создаёт ПАССАЖИР (он ищет место), а не водитель (он ищет
 * попутчика): формулировки вроде «кого ищут попутчиком» читались наоборот
 * и переворачивали роли, поэтому здесь ищет тот, кто едет без машины.
 *
 * Заменила статичные «Популярные направления»: те были списком городов,
 * вшитым в код, и показывали одно и то же всем. Здесь реальный спрос, а
 * «ближайшие» — это ближайшее по времени окно (сортировка на бэке,
 * `earliestAt asc`): географически сортировать нечем, у профиля нет ни города,
 * ни координат.
 *
 * Строки анонимные: бэк не отдаёт автора, поэтому видно «нужен попутчик», а не
 * «кто именно ищет». Свои заявки в ленте нет — они в профиле.
 *
 * Дата и время — по Москве (moscowDayKey / moscowTimeLabel): `earliestAt`
 * приходит UTC-ISO, и срез строки показал бы UTC-день и UTC-часы.
 *
 * Тап ведёт в поиск по маршруту заявки — то же, что делали направления:
 * водитель сразу видит, есть ли поездки на этот путь.
 *
 * Загрузка, пусто и ошибка — секция прячется (как NextTripBanner): витрина
 * спроса не должна занимать место на главной заголовком без строк.
 */
export function RideRequestFeedSection({
  onSelect,
}: RideRequestFeedSectionProps) {
  const feed = useRideRequestFeedQuery();

  if (feed.isLoading) return null;
  const items = feed.data ?? [];
  if (items.length === 0) return null;

  return (
    // Без headingLevel="h1": имя главной — у самой страницы
    // (VisuallyHidden h1 в HomePage), а не у секции.
    <Section header="Кто ищет попутку">
      {items.map((request) => {
        const departure = new Date(request.earliestAt);
        const date = dayLabel(moscowDayKey(departure));
        const time = moscowTimeLabel(departure);
        const route = `${request.fromCity.name} — ${request.toCity.name}`;
        const seats = `${request.seats} ${plural(
          request.seats,
          "место",
          "места",
          "мест",
        )}`;
        return (
          <Cell
            key={request.id}
            // Нативная кнопка обязательна (фасад, реестр #12): без
            // Component="button" строка не фокусируется Tab'ом и не
            // опознаётся скринридером как кнопка.
            Component="button"
            type="button"
            onClick={() => onSelect(request.fromCity.id, request.toCity.id)}
            after={<ChevronRight />}
            subtitle={`${date}, ${time} · ${seats}`}
            before={
              <IconContainer>
                <Route aria-hidden />
              </IconContainer>
            }
            // Имя строки целиком: «куда ехать» + «когда» + «сколько мест» —
            // иначе скринридер читает только города, а время и места теряются.
            aria-label={`Нужен попутчик ${route}, ${date}, ${time}, ${seats}`}
          >
            {`${request.fromCity.name} → ${request.toCity.name}`}
          </Cell>
        );
      })}
    </Section>
  );
}