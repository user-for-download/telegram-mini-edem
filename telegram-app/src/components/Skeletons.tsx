import { Skeleton } from "@telegram-apps/telegram-ui";

/* Скелетоны списков на tgui Skeleton (tgui.xelene.me, Blocks/Feedback).
 *
 * Skeleton — overlay-паттерн: visible прячет children под
 * --tgui--secondary_bg_color + шиммер; форму задают сами children
 * (высоты строк), поэтому болванки без собственного фона.
 * overflow-hidden обрезает overlay под скругление карточки.
 *
 * a11y: список объявляет обёртка (role="status" aria-label="Загрузка"),
 * сами болванки aria-hidden — скринридер слышит одно объявление.
 */

/** Болванка карточки поездки — зеркало раскладки TripCard:
 * время/маршрут/цена, адреса, водитель с аватаром и пилюля мест. */
export function TripCardSkeleton() {
  return (
    <Skeleton
      visible
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border border-(--tgui--outline)"
    >
      <div className="flex flex-col gap-3 p-4">
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
      </div>
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
      className="overflow-hidden rounded-2xl border border-(--tgui--outline)"
    >
      <div className="flex flex-col gap-2 p-4">
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
      </div>
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
      className="overflow-hidden rounded-2xl border border-(--tgui--outline)"
    >
      <div className="flex flex-col gap-2 p-3.5">
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
      </div>
    </Skeleton>
  );
}

/** Стопка болванок для начальной загрузки списка (QueryState skeleton). */
export function TripCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Загрузка">
      {Array.from({ length: count }, (_, index) => (
        <TripCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function NotificationCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Загрузка">
      {Array.from({ length: count }, (_, index) => (
        <NotificationCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function ReviewCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Загрузка">
      {Array.from({ length: count }, (_, index) => (
        <ReviewCardSkeleton key={index} />
      ))}
    </div>
  );
}
