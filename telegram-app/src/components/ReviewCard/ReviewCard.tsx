import { Star } from "lucide-react";
import { Caption, Text } from "@telegram-apps/telegram-ui";
import { REVIEW_STATUS, type Review } from "@edem/contracts";
import type { MyReview } from "@/api/reviews.api";
import { LazyAvatar } from "@/components/LazyAvatar";
import { FeedCard } from "@/components/FeedCard/FeedCard";
import { StatusPill, type StatusTone } from "@/components/StatusPill/StatusPill";
import styles from "./ReviewCard.module.css";

/** Подпись и тон статус-пилюли — только для непубличных отзывов. */
export function reviewStatusBadge(
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
 *  маршрут + статус публикации. */
export function ReviewCard({ review }: { review: Review | MyReview }) {
  const badge = reviewStatusBadge(review.status);
  return (
    <FeedCard className={styles.root}>
      <div className={styles.head}>
        <div className={styles.author}>
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
        </div>
        <div
          className={styles.rating}
          aria-label={`Оценка ${review.rating} из 5`}
        >
          {Array.from({ length: review.rating }, (_, index) => (
            <Star key={index} size={13} className={styles.star} />
          ))}
        </div>
      </div>
      <Text Component="div" className={styles.body}>
        {review.text}
      </Text>
      <Caption Component="div" className={styles.foot}>
        <span className={styles.route}>Маршрут: {review.tripRoute}</span>
        {badge ? (
          <StatusPill tone={badge.tone} className={styles.shrink}>
            {badge.label}
          </StatusPill>
        ) : (
          <Text
            weight="2"
            Component="span"
            className={styles.published}
          >
            Опубликован
          </Text>
        )}
      </Caption>
    </FeedCard>
  );
}
