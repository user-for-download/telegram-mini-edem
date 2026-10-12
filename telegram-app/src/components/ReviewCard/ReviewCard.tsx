import { Star } from "lucide-react";
import { Caption, Text } from "@telegram-apps/telegram-ui";
import { REVIEW_STATUS, type Review } from "@edem/contracts";
import type { MyReview } from "@/api/reviews.api";
import { LazyAvatar } from "@/components/LazyAvatar";
import { useOpenUserProfile } from "@/components/Profile/UserProfileProvider";
import { Card } from "@/ui/Card";
import { PROSE, SHRINK } from "@/ui/classes";
import {
  StatusPill,
  type StatusTone,
} from "@/components/StatusPill/StatusPill";
import styles from "./ReviewCard.module.css";

/** Подпись и тон статус-пилюли — только для непубличных отзывов. */
function reviewStatusBadge(
  status: Review["status"],
): { label: string; tone: StatusTone } | null {
  switch (status) {
    case REVIEW_STATUS.PENDING:
      return { label: "На модерации", tone: "warning" };
    case REVIEW_STATUS.REJECTED:
      return { label: "Отклонён", tone: "danger" };
    default:
      return null;
  }
}

/** Карточка отзыва (язык ProfileTab примера): автор, звёзды, текст,
 *  маршрут + статус публикации.
 *
 *  Шапка (аватар + имя автора) — кнопка шторки профиля. Кнопка занимает
 *  блок head (без звёзд справа), а не оборачивает всю карточку: у отзыва
 *  нет своего клика, и вложенный интерактив в Card был бы лишним. */
export function ReviewCard({ review }: { review: Review | MyReview }) {
  const badge = reviewStatusBadge(review.status);
  const openUserProfile = useOpenUserProfile();
  return (
    <Card className={styles.root}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.author}
          // Глагол — в aria-label: иначе дата из authorBody войдёт в имя
          // кнопки («Анна 12 сентября»), а действие не названо (M7 аудита).
          aria-label={`Открыть профиль: ${review.author.name}`}
          onClick={() =>
            openUserProfile({
              id: review.author.id,
              // Заголовок — роль автора в той поездке. targetRole — роль
              // того, О КОМ отзыв, а автор — вторая сторона: отзыв о
              // водителе писал пассажир, и наоборот (reviews/index.ts).
              // Имя заголовком не ставим — оно уже в hero (дубль «ФИО →
              // ФИО»).
              title: review.targetRole === "driver" ? "Пассажир" : "Водитель",
              initial: review.author,
            })
          }
        >
          <LazyAvatar
            size={28}
            src={review.author.avatar}
            acronym={review.author.name.slice(0, 1).toUpperCase()}
            alt={review.author.name}
          />
          <div className={styles.authorBody}>
            <Text weight="2" Component="div" className={styles.authorName}>
              {review.author.name}
            </Text>
            <Caption Component="div">{review.date}</Caption>
          </div>
        </button>
        <div
          className={styles.rating}
          aria-label={`Оценка ${review.rating} из 5`}
        >
          {Array.from({ length: review.rating }, (_, index) => (
            <Star key={index} size={13} className={styles.star} />
          ))}
        </div>
      </div>
      <Text Component="div" className={PROSE}>
        {review.text}
      </Text>
      <Caption Component="div" className={styles.foot}>
        <span className={styles.route}>Маршрут: {review.tripRoute}</span>
        {badge ? (
          <StatusPill tone={badge.tone} className={SHRINK}>
            {badge.label}
          </StatusPill>
        ) : (
          <Text weight="2" Component="span" className={styles.published}>
            Опубликован
          </Text>
        )}
      </Caption>
    </Card>
  );
}
