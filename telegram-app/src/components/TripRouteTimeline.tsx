import styles from "./TripRouteTimeline.module.css";

export interface TripRouteTimelineProps {
  fromCity: string;
  fromAddress?: string | null;
  /** Время отправления; без него — только город (время уже в шапке карточки). */
  fromTime?: string | null;
  toCity: string;
  toAddress?: string | null;
  arrival?: string | null;
  /** Отправление + длительность переходят через полночь. */
  arrivalNextDay?: boolean;
}

const ADDRESS_FALLBACK =
  "Точное место встречи станет доступно после подтверждения брони";

/**
 * Маршрут поездки: упорядоченный список двух остановок
 * (`<ol>` — у маршрута есть порядок, это его смысл) с рельсом
 * «точка — линия — точка».
 *
 * Почему не нативный tgui `Timeline`, который стоял здесь раньше:
 * у него `padding: 32px 44px` и `gap: 24px`. Внутри карточки с паддингом
 * 16 это давало 256px высоты на две строки маршрута и пустую полосу под
 * адресом прибытия — треть карточки. Для шторки деталей это не годно,
 * поэтому рельс свой, но той же геометрии и тех же токенов, что у
 * карточки поездки (`TripStandardCard`): кольцо отправления, заливка
 * прибытия, линия `--app-info` 30%. Язык маршрута в приложении один.
 *
 * Время стоит СЛЕВА отдельной колонкой: в поездке это первое, что ищут,
 * и колонка держит обе остановки выровненными друг под другом. Раньше
 * время сливалось с городом в заголовке пункта («06:00 · Вологда»).
 *
 * Маскированные адреса не повторяются под каждым городом: подсказка
 * одна, под маршрутом. Два одинаковых абзаца под двумя остановками
 * читались как ошибка и съедали три строки.
 */
export function TripRouteTimeline({
  fromCity,
  fromAddress,
  fromTime,
  toCity,
  toAddress,
  arrival,
  arrivalNextDay = false,
}: TripRouteTimelineProps) {
  const stops = [
    { city: fromCity, address: fromAddress, time: fromTime },
    { city: toCity, address: toAddress, time: arrival },
  ];
  const addressesHidden = !fromAddress || !toAddress;

  return (
    <div className={styles.wrap}>
      <ol className={styles.route}>
        {stops.map((stop, index) => {
          const isLast = index === stops.length - 1;
          return (
            <li className={styles.stop} key={`${stop.city}-${index}`}>
              <span className={styles.time}>{stop.time ?? ""}</span>
              <span className={styles.rail} aria-hidden>
                <span className={isLast ? styles.dotTo : styles.dotFrom} />
                {!isLast && <span className={styles.line} />}
              </span>
              <span className={styles.body}>
                <span className={styles.city}>{stop.city}</span>
                {stop.address && (
                  <span className={styles.place}>{stop.address}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {arrivalNextDay && (
        <p className={styles.hint}>Прибытие на следующий день</p>
      )}
      {addressesHidden && <p className={styles.hint}>{ADDRESS_FALLBACK}</p>}
    </div>
  );
}
