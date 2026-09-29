import { Caption, Text } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { IconButton } from "@/ui/IconButton";
import { Stack } from "@/ui/Stack";
import { GROW, ROW_BETWEEN, TRUNCATE, BTN_ROW_WRAP } from "@/ui/classes";
import { LazyAvatar } from "@/components/LazyAvatar";
import { TripRouteTimeline } from "@/components/TripRouteTimeline";
import { dayLabel, formatDuration } from "@/utils/date";
import { hapticFeedback } from "@tma.js/sdk-react";
import { Phone, Send, ShieldCheck, Star } from "lucide-react";
import type { Trip } from "@edem/contracts";
import styles from "./TripDetailsPage.module.css";

function formatDurationLocal(minutes: number): string {
  return formatDuration(minutes);
}

interface TripHeroProps {
  item: Trip;
  shareStatus: string | null;
  isConfirmedBooking: boolean;
  hasActiveBooking: boolean;
  arrival: string;
  onShare: () => void;
}

/**
 * Верх деталей: маршрут с таймлайном, водитель, шаринг, авто, теги,
 * комментарий водителя. Чистый рендер — состояние живёт в useTripActions.
 */
export function TripHero({
  item,
  shareStatus,
  isConfirmedBooking,
  hasActiveBooking,
  arrival,
  onShare,
}: TripHeroProps) {
  return (
    <>
      <div className={styles.routeCard}>
        <Caption className={ROW_BETWEEN} Component="div">
          <span>{dayLabel(item.date)}</span>
          <span>
            В пути ~ {formatDurationLocal(item.durationMinutes)} ·{" "}
            {item.distanceKm} км
          </span>
        </Caption>

        <TripRouteTimeline
          fromCity={item.fromCity}
          fromAddress={item.fromAddress}
          fromTime={item.time}
          toCity={item.toCity}
          toAddress={item.toAddress}
          arrival={arrival}
        />
      </div>

      <div className={styles.driverCard}>
        <div className={styles.driverRow}>
          <LazyAvatar
            size={40}
            src={item.driver.avatar}
            acronym={item.driver.name.slice(0, 1).toUpperCase()}
            alt={item.driver.name}
          />
          <div className={GROW}>
            <Text weight="2" Component="div" className={styles.nameRow}>
              <span className={TRUNCATE}>{item.driver.name}</span>
              {item.driver.isVerified && (
                <ShieldCheck size={15} className={styles.verified} />
              )}
            </Text>
            <Caption Component="div" className={styles.ratingRow}>
              <Star size={12} className={styles.star} />
              <span>{item.driver.rating.toFixed(1)}</span>
              <span>({item.driver.reviewsCount} отзывов)</span>
            </Caption>
          </div>
        </div>

        <div className={styles.driverActions}>
          <IconButton
            size="m"
            variant="muted"
            onClick={onShare}
            aria-label="Поделиться поездкой"
            title="Поделиться поездкой"
          >
            <Send size={16} />
          </IconButton>
          {item.driver.phone && isConfirmedBooking ? (
            <IconButton
              size="m"
              variant="muted"
              aria-label={`Позвонить водителю: ${item.driver.phone}`}
              title={item.driver.phone}
              onClick={() => {
                hapticFeedback.impactOccurred.ifAvailable("light");
                window.location.assign(`tel:${item.driver.phone}`);
              }}
            >
              <Phone size={16} />
            </IconButton>
          ) : (
            hasActiveBooking &&
            !isConfirmedBooking && (
              <IconButton
                size="m"
                variant="muted"
                disabled
                title="Телефон водителя доступен после подтверждения"
                aria-label="Телефон водителя доступен после подтверждения"
              >
                <Phone size={16} />
              </IconButton>
            )
          )}
        </div>
      </div>

      {/* Кнопка + статус — плотный стек (ритм 4px): статус сидит
          вплотную к кнопке без отрицательного марджина (было .pullUp
          margin-top:-8px поверх ритма 12 — те же 4px, U3). */}
      <Stack gap="2xs">
        <Button size="m" stretched before={<Send size={16} />} onClick={onShare}>
          Поделиться поездкой с попутчиком в Telegram
        </Button>
        {shareStatus && (
          <Caption Component="p" role="status">
            {shareStatus}
          </Caption>
        )}
      </Stack>

      {item.driver.car && (
        <div className={styles.carRow}>
          <Text weight="2" Component="span">
            {item.driver.car.model} · {item.driver.car.color}
          </Text>
          <Caption Component="span">
            {item.driver.car.plate ?? "Госномер после брони"}
          </Caption>
        </div>
      )}

      {item.tags.length > 0 && (
        <div className={BTN_ROW_WRAP}>
          {item.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      )}

      {item.comment && (
        <div className={styles.noteCard}>
          <Caption weight="2" Component="span" className={styles.noteTitle}>
            Комментарий водителя:
          </Caption>
          {item.comment}
        </div>
      )}
    </>
  );
}
