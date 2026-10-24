import { Caption, Text } from "@telegram-apps/telegram-ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { Blockquote } from "@/ui/Blockquote";
import { Button } from "@/ui/Button";
import { GroupLabel } from "@/ui/GroupLabel";
import { IconButton } from "@/ui/IconButton";
import { GROW, ICON_TARGET, TRUNCATE } from "@/ui/classes";
import { LazyAvatar } from "@/components/LazyAvatar";
import { useOpenUserProfile } from "@/components/Profile/UserProfileProvider";
import { TripRouteTimeline } from "@/components/TripRouteTimeline";
import { formatRating } from "@/helpers/rating";
import { formatDuration, relativeMoscowDay } from "@/utils/date";
import { plural } from "@/utils/plural";
import { terminalTripStatusLabel } from "@/utils/tripStatus";
import { hapticFeedback } from "@tma.js/sdk-react";
import { CarFront, Phone, Share2, ShieldCheck, Star } from "lucide-react";
import type { Trip } from "@edem/contracts";
import styles from "./TripDetailsPage.module.css";

interface TripHeroProps {
  item: Trip;
  shareStatus: string | null;
  isConfirmedBooking: boolean;
  hasActiveBooking: boolean;
  arrival: string;
  /** Цена в сводке — когда панели бронирования нет (водитель, архив, нет мест). */
  price?: number | null;
  /** Встроенный блок между маршрутом и водителем (заявки водителя). */
  afterRoute?: ReactNode;
  onShare: () => void;
}

/** Комментарий длиннее этого сворачивается до «Читать полностью». */
const COMMENT_PREVIEW_LENGTH = 240;

/** Отправление + длительность переходят через полночь. */
function arrivesNextDay(time: string, durationMinutes: number): boolean {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return false;
  return (
    Number(match[1]) * 60 +
      Number(match[2]) +
      Math.max(0, Math.round(durationMinutes)) >=
    1440
  );
}

/**
 * Верх деталей: маршрут, водитель вместе с автомобилем.
 * Состояние поездки живёт в useTripActions; условия — в TripConditions.
 *
 * Порядок — по вопросам, с которыми открывают поездку:
 *  1. когда и куда едем → карточка маршрута;
 *  2. кто везёт и на чём → одна группа «водитель + авто»;
 *
 * Шаринг — тихая иконка в шапке маршрута: действие относится к поездке,
 * а не к человеку, и больше не разрывает связку водителя и автомобиля.
 */
export function TripHero({
  item,
  shareStatus,
  isConfirmedBooking,
  hasActiveBooking,
  arrival,
  price,
  afterRoute,
  onShare,
}: TripHeroProps) {
  const openUserProfile = useOpenUserProfile();
  const terminal = terminalTripStatusLabel(item.status);

  return (
    <>
      <div className={styles.routeCard}>
        {/* Шапка: день слева, шаринг справа. Длительность и километры
            переехали под маршрут: на 320px они выдавливали дату в две
            строки. */}
        <div className={styles.routeHead}>
          <Text weight="2" Component="span">
            {relativeMoscowDay(item.departureAt)}
          </Text>
          <IconButton
            size="m"
            variant="gray"
            className={ICON_TARGET}
            aria-label="Поделиться поездкой"
            title="Поделиться поездкой"
            onClick={onShare}
          >
            <Share2 size={16} />
          </IconButton>
        </div>

        <TripRouteTimeline
          fromCity={item.fromCity}
          fromAddress={item.fromAddress}
          fromTime={item.time}
          toCity={item.toCity}
          toAddress={item.toAddress}
          arrival={arrival}
          arrivalNextDay={arrivesNextDay(item.time, item.durationMinutes)}
        />

        <div className={styles.routeFoot}>
          <Caption Component="span" className={styles.routeMeta}>
            {terminal ?? `В пути ~ ${formatDuration(item.durationMinutes)}`}
            {` · ${item.distanceKm} км`}
          </Caption>
          {price != null && (
            <Text weight="2" Component="span" className={styles.summaryPrice}>
              {price} ₽
            </Text>
          )}
        </div>

        {shareStatus && (
          <Caption Component="p" role="status" className={styles.shareStatus}>
            {shareStatus}
          </Caption>
        )}
      </div>

      {afterRoute}

      <div className={styles.driverCard}>
        <div className={styles.driverTop}>
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
                variant="gray"
                className={ICON_TARGET}
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
                  variant="gray"
                  className={ICON_TARGET}
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

        {/* Автомобиль — часть той же группы, что и водитель: отдельной
            плашкой он читался как ещё один равнозначный факт. */}
        {item.driver.car && (
          <div className={styles.carRow}>
            <CarFront size={16} className={styles.carIcon} aria-hidden />
            <div className={styles.carText}>
              <Text weight="2" Component="div">
                {item.driver.car.model} · {item.driver.car.color}
              </Text>
              {item.driver.car.plate && (
                <Caption Component="div">{item.driver.car.plate}</Caption>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Условия поездки и комментарий водителя — отдельным блоком после выбора
 * места. Это вторичная информация: она не должна отодвигать цену и
 * основное действие за первый экран.
 */
export function TripConditions({ item }: { item: Trip }) {
  const [commentExpanded, setCommentExpanded] = useState(false);
  const commentIsLong = (item.comment?.length ?? 0) > COMMENT_PREVIEW_LENGTH;
  if (item.tags.length === 0 && !item.comment) return null;

  return (
    <>
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
          <GroupLabel Component="span">Комментарий водителя</GroupLabel>
          {/* Комментарий — свободный текст человека (контракт допускает 500
              знаков, dto/trip.dto.ts), поэтому слова водителя идут через
              ui/Blockquote, как жалоба, ответ модерации и «О себе»: переносы,
              набранные им, не склеиваются в одну строку, а длинное слово без
              пробела (ссылка, имя файла) не вылезает за блок. Правила
              переносов живут в фасаде — руками на потребителе их не пишем.
              Длинный текст сворачивается до превью, но остаётся в DOM
              целиком: это данные водителя, их режет только контракт. */}
          <Blockquote
            className={[
              styles.noteQuote,
              commentIsLong && !commentExpanded ? styles.noteClamp : undefined,
            ]
              .filter(Boolean)
              .join(" ")}
            topRightIcon={null}
          >
            {item.comment}
          </Blockquote>
          {commentIsLong && (
            <Button
              variant="ghost"
              size="m"
              className={styles.commentToggle}
              aria-expanded={commentExpanded}
              onClick={() => setCommentExpanded((value) => !value)}
            >
              {commentExpanded ? "Свернуть" : "Читать полностью"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
