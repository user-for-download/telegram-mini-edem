import { Star } from "lucide-react";
import { Caption, Text } from "@telegram-apps/telegram-ui";
import { REVIEW_STATUS, type Review } from "@edem/contracts";
import type { MyReview } from "@/api/reviews.api";
import { LazyAvatar } from "@/components/LazyAvatar";
import { FeedCard } from "@/components/FeedCard";
import { StatusPill, type StatusTone } from "@/components/StatusPill";

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
    <FeedCard className="p-3.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LazyAvatar
            size={28}
            src={review.author.avatar}
            acronym={review.author.name.slice(0, 1).toUpperCase()}
            alt={review.author.name}
          />
          <div className="min-w-0">
            <Text weight="2" Component="div" className="truncate">
              {review.author.name}
            </Text>
            <Caption Component="div">{review.date}</Caption>
          </div>
        </div>
        <div
          className="flex items-center gap-0.5 text-(--app-rating) shrink-0"
          aria-label={`Оценка ${review.rating} из 5`}
        >
          {Array.from({ length: review.rating }, (_, index) => (
            <Star key={index} size={13} className="fill-current" />
          ))}
        </div>
      </div>
      <Text Component="div" className="leading-relaxed">
        {review.text}
      </Text>
      <Caption
        Component="div"
        className="flex items-center justify-between gap-2 pt-1 border-t border-(--tgui--outline)"
      >
        <span className="truncate">Маршрут: {review.tripRoute}</span>
        {badge ? (
          <StatusPill tone={badge.tone} className="shrink-0">
            {badge.label}
          </StatusPill>
        ) : (
          <Text
            weight="2"
            Component="span"
            className="text-(--app-success) shrink-0"
          >
            Опубликован
          </Text>
        )}
      </Caption>
    </FeedCard>
  );
}
