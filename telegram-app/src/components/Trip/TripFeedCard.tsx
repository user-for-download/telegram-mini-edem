import {
  Baby,
  Cigarette,
  CigaretteOff,
  Luggage,
  PawPrint,
  ShieldCheck,
  Star,
  VolumeX,
} from "lucide-react";
import type { Trip, TripTag } from "@edem/contracts";
import { useNavigate } from "react-router-dom";
import { Caption, Tappable, Text } from "@telegram-apps/telegram-ui";
import { StatusPill } from "@/components/StatusPill";
import { dayLabel, formatArrivalTime, formatDuration } from "@/utils/date";
import { haptic } from "@/utils/haptics";
import { LazyAvatar } from "@/components/LazyAvatar";
import styles from "./TripFeedCard.module.css";

/** Иконки для очевидных тегов (язык примера); остальные теги не
 *  иконизируем — их видно в деталях поездки. */
const TAG_ICONS: Partial<Record<TripTag, { Icon: typeof Luggage }>> = {
  "Можно с животными": { Icon: PawPrint },
  "Есть багаж": { Icon: Luggage },
  "Не курить": { Icon: CigaretteOff },
  "Можно курить": { Icon: Cigarette },
  "Можно с детьми": { Icon: Baby },
  "Тихая поездка": { Icon: VolumeX },
};

/**
 * Карточка поездки в ленте поиска (переименована из TripCard: имя
 * занято единой карточкой вкладки «Поездки»). Язык SearchTab эталона:
 * вся карточка кликабельна (нативный button, без отдельной кнопки
 * «Подробнее»), время → прибытие, маршрут + цена, адреса, водитель,
 * компактная цветная пилюля мест и иконки тегов.
 * Поверхность — рецепт FeedCard, но в module.css (миграция
 * папка/компонент); раскладка внутри — tgui-типографика.
 */
export function TripFeedCard({ trip }: { trip: Trip }) {
  const navigate = useNavigate();
  const fewSeats = trip.seatsAvailable <= 1;
  const duration = formatDuration(trip.durationMinutes);
  const arrival = formatArrivalTime(trip.time, trip.durationMinutes);

  return (
    <Tappable
      Component="button"
      type="button"
      onClick={() => {
        haptic.light();
        navigate(`/trips/${trip.id}`);
      }}
      className={styles.card}
    >
      <div className={styles.topRow}>
        <div className={styles.routeCol}>
          <div className={styles.when}>
            <Text weight="2" Component="span">
              {trip.time}
            </Text>
            {duration && <Caption Component="span">({duration})</Caption>}
            {arrival && <Caption Component="span">→ {arrival}</Caption>}
          </div>
          <Text weight="2" Component="div" className={styles.cities}>
            {trip.fromCity} → {trip.toCity}
          </Text>
          <Caption Component="div">{dayLabel(trip.date)}</Caption>
        </div>
        <div className={styles.priceCol}>
          <Text weight="2" Component="div">
            {trip.price} ₽
          </Text>
          <Caption className={styles.hint}>за место</Caption>
        </div>
      </div>

      {(trip.fromAddress || trip.toAddress) && (
        <Caption Component="div" className={styles.addresses}>
          {trip.fromAddress && (
            <div className={styles.truncate}>Посадка: {trip.fromAddress}</div>
          )}
          {trip.toAddress && (
            <div className={styles.truncate}>Высадка: {trip.toAddress}</div>
          )}
        </Caption>
      )}

      <div className={styles.footer}>
        <div className={styles.driver}>
          <LazyAvatar
            size={40}
            src={trip.driver.avatar}
            acronym={trip.driver.name.slice(0, 1).toUpperCase()}
            alt={trip.driver.name}
          />
          <div className={styles.driverBody}>
            <Text
              weight="2"
              Component="div"
              className={styles.driverName}
            >
              <span className={styles.truncate}>{trip.driver.name}</span>
              {trip.driver.isVerified && (
                <ShieldCheck className={styles.verified} aria-hidden />
              )}
            </Text>
            <Caption Component="div" className={styles.rating}>
              <Star className={styles.star} aria-hidden />
              <span>{trip.driver.rating.toFixed(1)}</span>
            </Caption>
          </div>
        </div>

        <div className={styles.side}>
          <StatusPill
            tone={
              trip.seatsAvailable === 0
                ? "danger"
                : fewSeats
                  ? "warning"
                  : "success"
            }
          >
            {trip.seatsAvailable === 0
              ? "Мест нет"
              : `Осталось мест: ${trip.seatsAvailable}`}
          </StatusPill>
          {trip.tags.length > 0 && (
            <div className={styles.tags}>
              {trip.tags.flatMap((tag) => {
                const entry = TAG_ICONS[tag];
                return entry ? [<entry.Icon key={tag} size={13} />] : [];
              })}
            </div>
          )}
        </div>
      </div>
    </Tappable>
  );
}
