import { Caption } from "@telegram-apps/telegram-ui";
import { useNavigate } from "react-router-dom";
import type { RideRequest } from "@edem/contracts";
import { Section } from "@/ui/Section";
import { SectionBody } from "@/ui/SectionBody";
import { TripDemandRow } from "./TripDemandRow";
import { useTripDemandQuery } from "@/queries/useRideRequestsQuery";
import { dayLabel, moscowDayKey, moscowTimeLabel } from "@/utils/date";
import { haptic } from "@/utils/haptics";
import { plural } from "@/utils/plural";

/**
 * Оговорка под заголовком. Авторов заявок бэк не отдаёт (приватность), а
 * активных заявок у одного человека бывает до трёх — поэтому `items.length`
 * это верхняя оценка ЛЮДЕЙ, а не число людей. Без этой строки заголовок
 * читался бы как точный счёт.
 */
const DEMAND_LIMIT_NOTE =
  "Заявки по маршруту и времени. Часть заявок может принадлежать одному человеку.";

/**
 * Заголовок карточки спроса. Число — `items.length`, то есть верхняя оценка
 * (см. DEMAND_LIMIT_NOTE).
 *
 * Формы слова и глагола берёт один `plural`: иначе «21 человек ищут» —
 * «человек» и «ищет» склоняются по одному правилу, а не по двум.
 */
export function demandTitle(count: number): string {
  const subject = plural(count, "человек ищет", "человека ищут", "человек ищут");
  return `${count} ${subject} попутку по твоему маршруту`;
}

/**
 * Окно заявки «30 сентября, 08:00 — 20:00». Время по Москве (общий `date.ts`):
 * `earliestAt`/`latestAt` приходят UTC-ISO, и срез строки показал бы UTC-часы.
 * День печатаем один раз, когда окно внутри суток: повтор съедал бы ширину
 * строки, а ночные окна (23:00 — 02:00) в заявках не редкость.
 */
export function demandWindow(request: RideRequest): string {
  const from = new Date(request.earliestAt);
  const to = new Date(request.latestAt);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return "Окно поездки не задано";
  }
  const fromTime = moscowTimeLabel(from);
  const toTime = moscowTimeLabel(to);
  const fromDay = moscowDayKey(from);
  const toDay = moscowDayKey(to);
  if (fromDay === toDay) {
    return `${dayLabel(fromDay)}, ${fromTime} — ${toTime}`;
  }
  return `${dayLabel(fromDay)}, ${fromTime} — ${dayLabel(toDay)}, ${toTime}`;
}

/**
 * Карточка спроса на свою активную поездку: «N человек ищут попутку по твоему
 * маршруту» и строки заявок общим `ui/MenuRow` (второй вид строки в проекте
 * не заводим — см. ui/README.md и ленту спроса на главной).
 *
 * Показывается только водителю: бэк отдаёт 403 остальным и 404 несуществующей
 * поездке, а хук включён лишь для поездок из своей вкладки «Водитель».
 *
 * Загрузка, пустой ответ и ошибка — одно и то же «показывать нечего»:
 * компонент возвращает null, как `RideRequestFeedSection`/`NextTripBanner`.
 * Тост об ошибке здесь не нужен и был бы вреден: молчащий 403 на каждой
 * карточке списка — это шум водителю, у которого спроса действительно нет.
 *
 * `seatsAvailable` — свободные места СВОЕЙ поездки, которые страница «Поездки»
 * уже держит в руках (тот же Trip из `useInfiniteMyTripsQuery`). Отдельный
 * запрос ради проверки мест не заводим: неизвестное значение (проп не передан)
 * оставляет действие доступным, а окончательный ответ — 409 с бэка.
 */
export function TripDemandCard({
  tripId,
  seatsAvailable,
}: {
  tripId: string;
  seatsAvailable?: number;
}) {
  const navigate = useNavigate();
  const demand = useTripDemandQuery(tripId);
  const requests = demand.data ?? [];

  if (requests.length === 0) return null;

  // Мест могло не остаться: позвать некуда. Неизвестное число мест (проп не
  // передан) считаем «места есть» — молча исчезающая кнопка водителю ничего
  // не объясняет, а сервер всё равно откажет.
  const canInvite = seatsAvailable === undefined || seatsAvailable > 0;

  // Отдельного экрана заявки нет (автор не отдаётся), поэтому тап по строке
  // открывает поездку — там же водитель видит состав и свободные места.
  const open = () => {
    haptic.light();
    navigate(`/trips/${tripId}`);
  };

  return (
    // Заголовок h2 (дефолт фасада): имя экрана — VisuallyHidden h1 страницы.
    <Section header={demandTitle(requests.length)}>
      <SectionBody>
        <Caption Component="p">{DEMAND_LIMIT_NOTE}</Caption>
        {requests.map((request) => (
          <TripDemandRow
            key={request.id}
            request={request}
            tripId={tripId}
            subtitle={demandWindow(request)}
            canInvite={canInvite}
            onOpen={open}
          />
        ))}
      </SectionBody>
    </Section>
  );
}
