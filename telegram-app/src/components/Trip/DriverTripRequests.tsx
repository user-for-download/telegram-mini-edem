import {
  Avatar,
  Caption,
  Skeleton,
  Subheadline,
} from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Cell } from "@/ui/Cell";
import { IconButton } from "@/ui/IconButton";
import { ICON_TARGET } from "@/ui/classes";
import { Notice } from "@/ui/Notice";

import { Armchair, Check, Star, X } from "lucide-react";
import { haptic } from "@/utils/haptics";
import { isNativeConfirmAvailable, nativeConfirm } from "@/utils/telegram-adapter";
import { useToast } from "@/components/Toast/ToastProvider";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { formatRating, hasRating } from "@/helpers/rating";
import { useOpenUserProfile } from "@/components/Profile/UserProfileProvider";
import {
  useDriverRequestsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";
import type { Booking } from "@edem/contracts";
import styles from "./TripCards.module.css";

/**
 * Активные заявки на поездку водителя: строки Cell в стиле персоны
 * карточки (аватар 40 + бейдж рейтинга, имя, subline) — аватар
 * пассажира, место и комментарий брони, IconButton «−»/«+» в after.
 * Клики гасят всплытие (строки живут внутри кликабельной карточки).
 *
 * Решение по заявке — через нативный popup (nativeConfirm): в браузере
 * (dev) действие выполняется сразу, без подтверждения. Диалога-«досье»
 * больше нет, поэтому комментарий пассажира виден прямо в строке.
 *
 * Данные — общий useDriverRequestsQuery (один запрос на все карточки,
 * кэш shared со счётчиками Главной): бэкенд /driver отдаёт только
 * pending на активных будущих поездках (take 50 суммарно — при >50
 * заявок строки обрежутся, точный счётчик — pendingRequestsCount).
 */
export function DriverTripRequests({ tripId }: { tripId: string }) {
  const toast = useToast();
  const query = useDriverRequestsQuery();
  const updateStatus = useUpdateBookingStatusMutation();
  const openUserProfile = useOpenUserProfile();
  // Болванки заявок — тот же tgui Skeleton, что и в components/Skeletons.tsx:
  // пульсацию 1.8s гасим ПРОПОМ по системной настройке (WCAG 2.3.3).
  const reduceMotion = usePrefersReducedMotion();

  const pending = (query.data ?? []).filter(
    (booking) => booking.trip.id === tripId && booking.status === "pending",
  );

  // Кнопки −/+ блокируем только у обрабатываемой строки.
  const actingId = updateStatus.isPending
    ? updateStatus.variables?.id
    : undefined;

  // Подтверждение — нативный popup клиента (в dev-браузере действие
  // выполняется сразу). Отклонить — destructive (красная кнопка).
  // Клиент без popup: nativeConfirm вернул бы false — неотличимо от
  // отказа, и тап уходил бы в молчаливый no-op. Поэтому доступность
  // проверяем заранее и показываем видимый исход (тост), а действие
  // без подтверждения не выполняем.
  const askAndAct = async (
    booking: Booking,
    status: "confirmed" | "declined",
  ) => {
    haptic.light();
    if (!isNativeConfirmAvailable()) {
      haptic.error();
      toast.show({
        text: "Не удалось запросить подтверждение — обновите Telegram",
        assertive: true,
      });
      return;
    }
    const confirmed = await nativeConfirm({
      title:
        status === "confirmed" ? "Подтвердить пассажира?" : "Отклонить заявку?",
      message: `${booking.passenger.name} · место №${booking.seat}`,
      confirmText: status === "confirmed" ? "Подтвердить" : "Отклонить",
      destructive: status === "declined",
    });
    if (!confirmed) return;
    act(booking.id, booking.passenger.name, status);
  };

  const act = (
    id: string,
    passengerName: string,
    status: "confirmed" | "declined",
  ) => {
    updateStatus.mutate(
      { id, status },
      {
        onSuccess: () => {
          haptic.success();
          toast.show({
            text:
              status === "confirmed"
                ? `Заявка ${passengerName} принята`
                : `Заявка ${passengerName} отклонена`,
          });
        },
        onError: (error) => {
          haptic.error();
          toast.show({
            text: bookingErrorMessage(error),
            assertive: true,
          });
        },
      },
    );
  };

  if (query.isLoading && pending.length === 0) {
    return (
      // Скелетон без действий: всплытие безвредно (тап открывает детали
      // поездки — тот же результат, что и тап по карточке), поэтому
      // stopPropagation-обёртка убрана (запрещена jsx-a11y).
      <div
        role="status"
        aria-label="Загрузка заявок"
        className={styles.requestsList}
      >
        {[0, 1].map((index) => (
          <Skeleton key={index} visible withoutAnimation={reduceMotion} aria-hidden="true">
            <div className={styles.requestSkeletonRow}>
              <span className={styles.requestSkeletonAvatar} />
              <span className={styles.requestSkeletonLines}>
                <span className={styles.requestSkeletonName} />
                <span className={styles.requestSkeletonSeat} />
              </span>
            </div>
          </Skeleton>
        ))}
      </div>
    );
  }

  if (query.error && pending.length === 0) {
    return (
      <div className={styles.requestsList}>
        <Notice role="alert" tone="danger" variant="text">
          {bookingErrorMessage(query.error)}
        </Notice>
        <Button
          size="s"
          onClick={(event) => {
            // «Повторить» не должен открывать детали поездки (карточка
            // кликабельна) — гасим всплытие в самой кнопке, а не обёрткой
            // (обёртки с onClick запрещены jsx-a11y).
            event.stopPropagation();
            void query.refetch();
          }}
        >
          Повторить
        </Button>
      </div>
    );
  }

  // F7: пустой список (нет pending на этот tripId — чужой tripId
  // отфильтрован выше) — null без заголовка/счётчика. Общий запрос
  // useDriverRequestsQuery shared с Главной, take не увеличиваем.
  if (pending.length === 0) return null;

  // Кнопки −/+ гасят всплытие сами. Обёртка с onClick запрещена jsx-a11y.
  return (
    <div className={styles.requestsList}>
      {updateStatus.error && (
        <Notice role="alert" tone="danger" variant="text">
          {bookingErrorMessage(updateStatus.error)}
        </Notice>
      )}
      {pending.map((booking) => (
        <Cell
          key={booking.id}
          className={styles.requestCell}
          // Комментарий пассажира переносится, а не обрезается многоточием:
          // без `multiline` кит ставит `white-space: nowrap` + ellipsis на
          // subtitle (`.tgui-…:not(.tgui-…multiline) …>*`), и текст вида
          // «· «Буду с рюкзаком, еду к родителям»» превращался в «· «Буду…».
          // Это документированный проп кита (Cell.d.ts: «Allows for multiline
          // content without truncation»), а не CSS-костыль.
          multiline
          before={
            <Avatar
              size={40}
              src={booking.passenger.avatar}
              acronym={booking.passenger.name.slice(0, 2).toUpperCase()}
            />
          }
          subtitle={
            <Caption
              level="1"
              Component="p"
              weight="3"
              className={styles.requestSubtitle}
            >
              {/* Мета одной строкой в inline-flex: рейтинг · место.
                  Флекс не даёт разделителю оторваться от соседа (обычный
                  текст переносил « · » в конец строки), а комментарий уходит
                  следующим блоком — он реплика пассажира, а не ещё один
                  факт в перечислении. */}
              <span className={styles.requestMeta}>
                <span
                  className={styles.requestRating}
                  role="img"
                  aria-label={
                    hasRating(
                      booking.passenger.rating,
                      booking.passenger.reviewsCount,
                    )
                      ? `Рейтинг ${formatRating(
                          booking.passenger.rating,
                          booking.passenger.reviewsCount,
                        )} из 5`
                      : "Рейтинг пока отсутствует"
                  }
                >
                  {hasRating(
                    booking.passenger.rating,
                    booking.passenger.reviewsCount,
                  ) && (
                    <Star
                      size={11}
                      fill="currentColor"
                      strokeWidth={0}
                      aria-hidden
                    />
                  )}
                  {formatRating(
                    booking.passenger.rating,
                    booking.passenger.reviewsCount,
                  )}
                </span>
                <span className={styles.metaSep} aria-hidden>
                  ·
                </span>
                <span className={styles.seat}>
                  <Armchair size={14} aria-hidden />
                  {`место №${booking.seat}`}
                </span>
              </span>
              {booking.comment?.trim() ? (
                <span className={styles.comment}>
                  {`«${booking.comment.trim()}»`}
                </span>
              ) : null}
            </Caption>
          }
          after={
            <span className={styles.requestActions}>
              <IconButton
                variant="outline"
                size="s"
                aria-label={`Отклонить заявку ${booking.passenger.name}`}
                disabled={actingId === booking.id}
                className={`${styles.declineIcon} ${ICON_TARGET}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void askAndAct(booking, "declined");
                }}
              >
                <X size={18} />
              </IconButton>
              <IconButton
                variant="secondary"
                size="s"
                aria-label={`Принять заявку ${booking.passenger.name}`}
                disabled={actingId === booking.id}
                className={ICON_TARGET}
                onClick={(event) => {
                  event.stopPropagation();
                  void askAndAct(booking, "confirmed");
                }}
              >
                <Check size={18} />
              </IconButton>
            </span>
          }
        >
          {/* Имя пассажира — кнопка шторки профиля. Cell целиком кнопкой
              быть не может: в его after живут IconButton −/+, и кнопка
              внутри кнопки запрещена. Поэтому интерактивно только имя —
              аватар в слоте before остаётся декоративным. */}
          <button
            type="button"
            className={styles.requestPerson}
            // Глагол — в aria-label: голое имя не говорит, что будет
            // (M7 аудита). Label заменяет имя целиком.
            aria-label={`Открыть профиль: ${booking.passenger.name}`}
            onClick={(event) => {
              event.stopPropagation();
              openUserProfile({
                id: booking.passenger.id,
                // Заголовок — роль: имя уже в hero (дубль «ФИО → ФИО»).
                title: "Пассажир",
                initial: booking.passenger,
              });
            }}
          >
            <Subheadline level="2" Component="span" weight="2">
              {booking.passenger.name}
            </Subheadline>
          </button>
        </Cell>
      ))}
    </div>
  );
}
