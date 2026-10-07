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
 * Лента спроса на главной — суммаризатор по маршрутам: одна строка на пару
 * городов («Вологда → Череповец: ищут 2 человека · 2 места · ближайшая
 * завтра, 08:00»), а не строка на заявку. Список заявок занимал десяток строк
 * одного маршрута и не показывал масштаб спроса.
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
 * «Люди» и «места» — разные числа и показываются оба: человек может просить
 * несколько мест, поэтому «ищут 1 человека» не значит «нужно 1 место». Порядок
 * строк задаёт бэк: по спросу (места), затем по ближайшему окну.
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
        const nearest = new Date(request.nextAt);
        const date = dayLabel(moscowDayKey(nearest));
        const time = moscowTimeLabel(nearest);
        const route = `${request.fromCity.name} — ${request.toCity.name}`;
        const people = `${request.people} ${plural(
          request.people,
          "человек",
          "человека",
          "человек",
        )}`;
        const seats = `${request.seats} ${plural(
          request.seats,
          "место",
          "места",
          "мест",
        )}`;
        return (
          <Cell
            key={`${request.fromCity.id}:${request.toCity.id}`}
            // Нативная кнопка обязательна (фасад, реестр #12): без
            // Component="button" строка не фокусируется Tab'ом и не
            // опознаётся скринридером как кнопка.
            Component="button"
            type="button"
            onClick={() => onSelect(request.fromCity.id, request.toCity.id)}
            after={<ChevronRight />}
            subtitle={`ищут ${people} · ${seats} · ближайшая ${date}, ${time}`}
            before={
              <IconContainer>
                <Route aria-hidden />
              </IconContainer>
            }
            // Имя строки целиком: «куда ехать» + «когда» + «сколько мест» —
            // иначе скринридер читает только города, а время и места теряются.
            aria-label={`По маршруту ${route} ищут ${people} и ${seats}, ближайшая ${date} в ${time}`}
          >
            {`${request.fromCity.name} → ${request.toCity.name}`}
          </Cell>
        );
      })}
    </Section>
  );
}