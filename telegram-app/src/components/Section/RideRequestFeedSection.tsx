import { IconContainer } from "@telegram-apps/telegram-ui";
import { Route } from "lucide-react";
import { Cell } from "@/ui/Cell";
import { Section } from "@/ui/Section";
import { STATIC_CELL } from "@/ui/classes";
import { useRideRequestFeedQuery } from "@/queries/useRideRequestsQuery";
import { moscowDayLabel, moscowDayKey, moscowTimeLabel } from "@/utils/date";
import { plural } from "@/utils/plural";

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
 * **Строки НЕ кликабельны — это витрина, а не навигация** (решение владельца
 * 2026-10-09). Раньше тап вёл в поиск по маршруту, но шаг приглашения и
 * «карточка спроса под своей поездкой» сняты: спрос остался информацией, и
 * обещать переход к действию, которого у водителя нет, нечестно. Поэтому
 * `ui/Cell` (div) + `STATIC_CELL` — без шеврона, курсора и hover-подложки.
 *
 * «Люди» и «места» — разные числа и показываются оба: человек может просить
 * несколько мест, поэтому «ищут 1 человека» не значит «нужно 1 место». Порядок
 * строк задаёт бэк: по спросу (места), затем по ближайшему окну.
 *
 * Подпись строки короткая: «2 человека · 7 мест · Завтра, 08:00» — без слов
 * «ищут» и «ближайшая», которые повторяли заголовок секции и съедали ширину.
 *
 * `multiline` обязателен: подпись несёт значения (люди, места, когда), а кит
 * по умолчанию режет её многоточием — обрезался ровно хвост с датой. Ширину
 * строки держит `ui/MenuRow` (`width: 100%`), перенос — штатный проп кита.
 *
 * Загрузка, пусто и ошибка — секция прячется (как NextTripBanner): витрина
 * спроса не должна занимать место на главной заголовком без строк.
 */
export function RideRequestFeedSection() {
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
        const date = moscowDayLabel(moscowDayKey(nearest));
        const time = moscowTimeLabel(nearest);
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
            // Обязателен: без него кит-овский Tappable оставил бы курсор
            // указателя и hover-подложку (ложная кликабельность).
            className={STATIC_CELL}
            subtitle={`${people} · ${seats} · ${date}, ${time}`}
            // Штатный режим кита «content without truncation»: по умолчанию
            // подпись идёт в одну строку с `nowrap` + ellipsis, и при длинном
            // маршруте обрезался хвост — дата и время. Своих правил на
            // внутренние классы кита не пишем: хеш меняется при bump версии,
            // а `multiline` — публичный проп контракта (Cell.d.ts:25).
            multiline
            before={
              <IconContainer>
                <Route size={18} />
              </IconContainer>
            }
          >
            {`${request.fromCity.name} → ${request.toCity.name}`}
          </Cell>
        );
      })}
    </Section>
  );
}
