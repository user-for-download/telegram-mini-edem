import type { ReactNode } from "react";
import { Skeleton } from "@telegram-apps/telegram-ui";
import { Stack } from "@/ui/Stack";
import { CARD_PAD, CARD_SURFACE } from "@/ui/classes";
import styles from "./Skeletons.module.css";

/* Скелетоны списков на tgui Skeleton (tgui.xelene.me, Blocks/Feedback).
 *
 * Skeleton — overlay-паттерн: visible прячет children под
 * --tgui--secondary_bg_color + шиммер; форму задают сами children
 * (высоты строк), поэтому болванки без собственного фона.
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
      className={`${styles.cardSkeleton} ${CARD_SURFACE}`}
    >
      <Stack className={CARD_PAD}>
        <div className={styles.topRow}>
          <div className={styles.routeCol}>
            <div className={styles.lineTime} />
            <div className={styles.lineCities} />
            <div className={styles.lineSub} />
          </div>
          <div className={styles.priceCol}>
            <div className={styles.linePrice} />
            <div className={styles.lineUnit} />
          </div>
        </div>
        <div className={styles.lineAddress} />
        <div className={styles.footer}>
          <div className={styles.driverInfo}>
            <div className={styles.avatarCircle} />
            <div className={styles.driverLines}>
              <div className={styles.lineDriverName} />
              <div className={styles.lineDriverRating} />
            </div>
          </div>
          <div className={styles.seatsPill} />
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
      className={`${styles.cardSkeleton} ${CARD_SURFACE}`}
    >
      <Stack gap="xs" className={CARD_PAD}>
        <div className={styles.notifHead}>
          <div className={styles.lineNotifTitle} />
          <div className={styles.notifPill} />
        </div>
        <div className={styles.lineFull} />
        <div className={styles.line60} />
        <div className={styles.lineSub} />
        <div className={styles.notifFooter}>
          <div className={styles.lineDate} />
          <div className={styles.notifActionBtn} />
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
      className={`${styles.cardSkeleton} ${CARD_SURFACE}`}
    >
      <Stack gap="xs" className={CARD_PAD}>
        <div className={styles.reviewHead}>
          <div className={styles.authorInfo}>
            <div className={styles.authorAvatar} />
            <div className={styles.authorLines}>
              <div className={styles.lineAuthorName} />
              <div className={styles.lineAuthorRole} />
            </div>
          </div>
          <div className={styles.starsRow}>
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className={styles.starItem} />
            ))}
          </div>
        </div>
        <div className={styles.lineFull} />
        <div className={styles.line80} />
        <div className={styles.line50} />
      </Stack>
    </Skeleton>
  );
}

/** Болванка профиль-бара главной: аватар + имя + пилюля рейтинга.
 *  Отступы — у родителя (страница), здесь только форма. */
export function ProfileBarSkeleton() {
  return (
    <div role="status" aria-label="Загрузка профиля">
      <Skeleton
        visible
        aria-hidden="true"
        className={styles.profileBarRoot}
      >
        <div className={styles.profileBarContent}>
          <div className={styles.profileBarUser}>
            <div className={styles.avatarCircle} />
            <div className={styles.lineDriverName} />
          </div>
          <div className={styles.profileBarRating} />
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

