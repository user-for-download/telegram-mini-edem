import { Caption, Text } from "@telegram-apps/telegram-ui";
import { Blockquote } from "@/ui/Blockquote";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Stack } from "@/ui/Stack";
import { GROW, TRUNCATE } from "@/ui/classes";
import { LazyAvatar } from "@/components/LazyAvatar";
import { useOpenUserProfile } from "@/components/Profile/UserProfileProvider";
import { TripRouteTimeline } from "@/components/TripRouteTimeline";
import { formatRating } from "@/helpers/rating";
import { formatDuration, relativeMoscowDay } from "@/utils/date";
import { plural } from "@/utils/plural";
import { terminalTripStatusLabel } from "@/utils/tripStatus";
import { hapticFeedback } from "@tma.js/sdk-react";
import { CarFront, Phone, Send, ShieldCheck, Star } from "lucide-react";
import type { Trip } from "@edem/contracts";
import styles from "./TripDetailsPage.module.css";

interface TripHeroProps {
  item: Trip;
  shareStatus: string | null;
  isConfirmedBooking: boolean;
  hasActiveBooking: boolean;
  arrival: string;
  onShare: () => void;
}

/**
 * Верх деталей: маршрут, водитель, шаринг, авто, теги, комментарий
 * водителя. Чистый рендер — состояние живёт в useTripActions.
 *
 * Порядок — по вопросам, с которыми открывают поездку:
 *  1. когда и куда едем → карточка маршрута;
 *  2. кто везёт и можно ли связаться → карточка водителя;
 *  3. на чём → строка авто;
 *  4. остальное → теги и комментарий.
 * Шаринг живёт ПОСЛЕ водителя, а не иконкой внутри его карточки: в
 * карточке водителя две иконки-действия (поделиться и телефон) читались
 * как «действия с водителем», хотя поделиться можно поездкой, а не
 * человеком. Иконка шаринга убрана — осталась явная кнопка ниже.
 */
export function TripHero({
  item,
  shareStatus,
  isConfirmedBooking,
  hasActiveBooking,
  arrival,
  onShare,
}: TripHeroProps) {
  const openUserProfile = useOpenUserProfile();
  const terminal = terminalTripStatusLabel(item.status);

  return (
    <>
      <div className={styles.routeCard}>
        {/* Шапка карточки: слева день, справа путь — как в карточке
            поездки (там дата слева, цена справа). Две подписи по краям
            читаются лучше, чем строка, растянутая space-between через
            всю ширину. */}
        <div className={styles.routeHead}>
          <Text weight="2" Component="span">
            {relativeMoscowDay(item.departureAt)}
          </Text>
          <Caption Component="span" className={styles.routeMeta}>
            {terminal ?? `В пути ~ ${formatDuration(item.durationMinutes)}`}
            {` · ${item.distanceKm} км`}
          </Caption>
        </div>

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
        {/* Карточка водителя открывает шторку его профиля. Кнопка —
            сосед блока действий справа, а не их родитель: вложенные
            кнопки запрещены, и «Позвонить» остаётся самостоятельным
            действием. */}
        <button
          type="button"
          className={styles.driverOpen}
          // Глагол — в aria-label: без него скринридер слышит «кнопка,
          // Иван…» и цель не названа. Label заменяет имя целиком, поэтому
          // рейтинг и счётчик в него не входят (M7 аудита).
          aria-label={`Открыть профиль: ${item.driver.name}`}
          onClick={() =>
            openUserProfile({
              id: item.driver.id,
              // Заголовок — роль, а не имя: имя уже в hero (дубль «ФИО →
              // ФИО»).
              title: "Водитель",
              initial: item.driver,
            })
          }
        >
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
                {/* Без отзывов — прочерк «—», а не мнимое 5.0 нового
                    водителя: контракт отдаёт rating обязательным числом
                    (app.md §5, formatRating). Счётчик ниже — всегда. */}
                <span>
                  {formatRating(item.driver.rating, item.driver.reviewsCount)}
                </span>
                <span>
                  ({item.driver.reviewsCount}{" "}
                  {plural(
                    item.driver.reviewsCount,
                    "отзыв",
                    "отзыва",
                    "отзывов",
                  )}
                  )
                </span>
              </Caption>
            </div>
          </div>
        </button>

        <div className={styles.driverActions}>
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
        <Button
          size="m"
          stretched
          before={<Send size={16} />}
          onClick={onShare}
        >
          Поделиться поездкой
        </Button>
        {shareStatus && (
          <Caption Component="p" role="status">
            {shareStatus}
          </Caption>
        )}
      </Stack>

      {item.driver.car && (
        <div className={styles.carRow}>
          <CarFront size={20} className={styles.carIcon} aria-hidden />
          <div className={styles.carText}>
            <Text weight="2" Component="div">
              {item.driver.car.model} · {item.driver.car.color}
            </Text>
            <Caption Component="div">
              {item.driver.car.plate ?? "Госномер после брони"}
            </Caption>
          </div>
        </div>
      )}

      {item.tags.length > 0 && (
        // Теги — статические подписи, а не управляющие элементы: раньше это
        // были Chip'ы кита (интерактивный фасад, кегль 16 через Subheadline),
        // и «Тихая поездка» читалась как заголовок раздела. Здесь это
        // пилюли 13px — мета-роль, один ряд, перенос по словам.
        <ul className={styles.tags}>
          {item.tags.map((tag) => (
            <li key={tag} className={styles.tag}>
              {tag}
            </li>
          ))}
        </ul>
      )}

      {item.comment && (
        <div className={styles.noteCard}>
          <Caption weight="2" Component="span" className={styles.noteTitle}>
            Комментарий водителя
          </Caption>
          {/* Комментарий — свободный текст человека (контракт допускает 500
              знаков, dto/trip.dto.ts), поэтому слова водителя идут через
              ui/Blockquote, как жалоба, ответ модерации и «О себе»: переносы,
              набранные им, не склеиваются в одну строку, а длинное слово без
              пробела (ссылка, имя файла) не вылезает за блок. Правила
              переносов живут в фасаде — руками на потребителе их не пишем. */}
          <Blockquote className={styles.noteQuote} topRightIcon={null}>
            {item.comment}
          </Blockquote>
        </div>
      )}
    </>
  );
}
