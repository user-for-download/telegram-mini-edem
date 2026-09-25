import type { ReactNode } from "react";
import { Skeleton } from "@telegram-apps/telegram-ui";
import { Stack } from "@/ui/Stack";
import { CARD_PAD, CARD_SURFACE } from "@/ui/classes";

/* Скелетоны списков на tgui Skeleton (tgui.xelene.me, Blocks/Feedback).
 *
 * Skeleton — overlay-паттерн: visible прячет children под
 * --tgui--secondary_bg_color + шиммер; форму задают сами children
 * (высоты строк), поэтому болванки без собственного фона.
 * overflow-hidden обрезает overlay под скругление карточки.
 *
 * a11y: список объявляет обёртка (role="status" aria-label="Загрузка"),
 * сами болванки aria-hidden — скринридер слышит одно объявление.
 * Одиночные болванки (без списка) role="status" НЕ несут: их объявляет
 * родитель — QueryState skeleton через SkeletonStack или FetchMore
 * через свой role="status"-контейнер (placeholderLabel).
 */

/** Болванка карточки ленты поиска — зеркало раскладки TripFeedCard:
 * время/маршрут/цена, адреса, водитель с аватаром и пилюля мест. */
export function TripCardSkeleton() {
  return (
    <Skeleton
      visible
      aria-hidden="true"
      className={`overflow-hidden ${CARD_SURFACE}`}
    >
      <Stack className={CARD_PAD}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="h-4 w-28" />
            <div className="h-3.5 w-44" />
            <div className="h-3 w-20" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="h-4 w-14" />
            <div className="h-3 w-12" />
          </div>
        </div>
        <div className="h-3 w-2/5" />
        <div className="flex items-center justify-between gap-2 border-t border-(--tgui--outline) pt-2">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full" />
            <div className="flex flex-col gap-1">
              <div className="h-3 w-24" />
              <div className="h-2.5 w-14" />
            </div>
          </div>
          <div className="h-5 w-28 rounded-full" />
        </div>
      </Stack>
    </Skeleton>
  );
}

/** Болванка уведомления — зеркало NotificationCard:
 * заголовок + статус-пилюля, текст, дата, футер со ссылкой/кнопкой. */
export function NotificationCardSkeleton() {
  return (
    <Skeleton
      visible
      aria-hidden="true"
      className={`overflow-hidden ${CARD_SURFACE}`}
    >
      <Stack gap="xs" className={CARD_PAD}>
        <div className="flex items-center justify-between gap-2">
          <div className="h-4 w-2/5" />
          <div className="h-5 w-16 rounded-full" />
        </div>
        <div className="h-3 w-full" />
        <div className="h-3 w-3/5" />
        <div className="h-3 w-28" />
        <div className="flex items-center gap-3 border-t border-(--tgui--outline) pt-2">
          <div className="h-3 w-16" />
          <div className="h-8 w-36 rounded-xl" />
        </div>
      </Stack>
    </Skeleton>
  );
}

/** Болванка отзыва — зеркало ReviewCard: автор с аватаром,
 * звёзды, строки текста, маршрут. */
export function ReviewCardSkeleton() {
  return (
    <Skeleton
      visible
      aria-hidden="true"
      className={`overflow-hidden ${CARD_SURFACE}`}
    >
      <Stack gap="xs" className={CARD_PAD}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full" />
            <div className="flex flex-col gap-1">
              <div className="h-3 w-24" />
              <div className="h-2.5 w-16" />
            </div>
          </div>
          <div className="flex gap-0.5">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-3 w-3" />
            ))}
          </div>
        </div>
        <div className="h-3 w-full" />
        <div className="h-3 w-4/5" />
        <div className="h-2.5 w-1/2" />
      </Stack>
    </Skeleton>
  );
}

/** Болванка профиль-бара главной: аватар + имя + пилюля рейтинга.
 *  Отступы — у родителя (страница px-4), здесь только форма. */
export function ProfileBarSkeleton() {
  return (
    <div role="status" aria-label="Загрузка профиля">
      <Skeleton
        visible
        aria-hidden="true"
        className="overflow-hidden rounded-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-full" />
            <div className="h-4 w-28" />
          </div>
          <div className="h-6 w-14 rounded-full" />
        </div>
      </Skeleton>
    </div>
  );
}

/** Общая обёртка стопки болванок (U1): одно role="status"-объявление
 *  на список вместо трёх копий div-обёртки. Дети — одиночные болванки
 *  (aria-hidden), ключи ставят вызывающие списки. */
function SkeletonStack({
  label = "Загрузка",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <Stack role="status" aria-label={label}>
      {children}
    </Stack>
  );
}

/** Стопка болванок для начальной загрузки списка (QueryState skeleton). */
export function TripCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonStack>
      {Array.from({ length: count }, (_, index) => (
        <TripCardSkeleton key={index} />
      ))}
    </SkeletonStack>
  );
}

export function NotificationCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonStack>
      {Array.from({ length: count }, (_, index) => (
        <NotificationCardSkeleton key={index} />
      ))}
    </SkeletonStack>
  );
}

export function ReviewCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonStack>
      {Array.from({ length: count }, (_, index) => (
        <ReviewCardSkeleton key={index} />
      ))}
    </SkeletonStack>
  );
}
