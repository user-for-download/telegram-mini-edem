import { Star } from "lucide-react";
import { REVIEW_STATUS, type Review } from "@edem/contracts";
import type { MyReview } from "@/api/reviews.api";
import { LazyAvatar } from "@/components/LazyAvatar";

/** Подпись и тон статус-пилюли — только для непубличных отзывов. */
export function reviewStatusBadge(
  status: Review["status"],
): { label: string; tone: string } | null {
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
    <div className="p-3.5 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LazyAvatar
            size={28}
            src={review.author.avatar}
            acronym={review.author.name.slice(0, 1).toUpperCase()}
            alt={review.author.name}
          />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--tgui--text_color)] truncate">
              {review.author.name}
            </div>
            <div className="text-[11px] text-[var(--tgui--hint_color)]">{review.date}</div>
          </div>
        </div>
        <div
          className="flex items-center gap-0.5 text-[var(--app-rating)] shrink-0"
          aria-label={`Оценка ${review.rating} из 5`}
        >
          {Array.from({ length: review.rating }, (_, index) => (
            <Star key={index} size={13} className="fill-current" />
          ))}
        </div>
      </div>
      <div className="text-[13px] text-[var(--tgui--text_color)] leading-relaxed">
        {review.text}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--tgui--hint_color)] pt-1 border-t border-[var(--tgui--outline)]">
        <span className="truncate">Маршрут: {review.tripRoute}</span>
        {badge ? (
          <span className="StatusPill shrink-0" data-tone={badge.tone}>
            {badge.label}
          </span>
        ) : (
          <span className="text-[var(--app-success)] font-medium shrink-0">Опубликован</span>
        )}
      </div>
    </div>
  );
}
