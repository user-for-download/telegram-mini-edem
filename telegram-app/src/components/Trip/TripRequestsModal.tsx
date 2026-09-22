import { memo, useCallback, useMemo, useState } from "react";
import {
  Button,
  Caption,
  Modal,
  Placeholder,
  Spinner,
  Text,
} from "@telegram-apps/telegram-ui";
import { useNavigate, useParams } from "react-router-dom";
import { LazyAvatar } from "@/components/LazyAvatar";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { OfflineBanner } from "@/components/OfflineBanner";
import { haptic } from "@/utils/haptics";
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import { useModalBack } from "@/utils/modalBack";
import { TripPage } from "@/pages/Trip/TripPage";
import {
  RequestConfirmDialog,
  type DriverBookingAction,
} from "@/components/Trip/RequestConfirmDialog";
import {
  bookingErrorMessage,
  isAuthorizationError,
} from "@/helpers/bookingErrors";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  useTripBookingsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";
import styles from "./TripModals.module.css";

type TripBooking = NonNullable<
  ReturnType<typeof useTripBookingsQuery>["data"]
>["pages"][number]["items"][number];

/** Карточка ожидающей заявки с Accept/Decline (таргеты ≥44px, min-h). */
const PendingBookingCard = memo(function PendingBookingCard({
  booking,
  pending,
  onAccept,
  onDecline,
}: {
  booking: TripBooking;
  pending: boolean;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.rowInfo}>
          <LazyAvatar
            size={40}
            src={booking.passenger.avatar}
            acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
            alt={booking.passenger.name}
          />
          <div className={styles.grow}>
            <Text Component="div" className={styles.truncate}>
              {booking.passenger.name}
            </Text>
            <Caption Component="div">
              {`место ${booking.seat}${booking.comment ? ` · «${booking.comment}»` : ""}`}
            </Caption>
          </div>
        </div>
        <StatusPill tone="warning" className={styles.shrink}>
          Ожидает решения
        </StatusPill>
      </div>
      <div className={styles.btnRow}>
        <Button
          mode="bezeled"
          stretched
          size="s"
          className="min-h-11"
          disabled={pending}
          onClick={() => onAccept(booking.id)}
        >
          Принять
        </Button>
        <Button
          mode="bezeled"
          stretched
          size="s"
          className="min-h-11"
          disabled={pending}
          onClick={() => onDecline(booking.id)}
        >
          Отклонить
        </Button>
      </div>
    </div>
  );
});

/** Карточка подтверждённого пассажира (только чтение). */
const ConfirmedBookingCard = memo(function ConfirmedBookingCard({
  booking,
}: {
  booking: TripBooking;
}) {
  return (
    <div className={styles.cardRow}>
      <div className={styles.rowInfo}>
        <LazyAvatar
          size={40}
          src={booking.passenger.avatar}
          acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
          alt={booking.passenger.name}
        />
        <div className={styles.grow}>
          <Text Component="div" className={styles.truncate}>
            {booking.passenger.name}
          </Text>
          <Caption Component="div">{`место ${booking.seat}`}</Caption>
        </div>
      </div>
      <StatusPill tone="success" className={styles.shrink}>
        Подтверждён
      </StatusPill>
    </div>
  );
});

/**
 * Заявки пассажиров — route-backed шторка поверх «Поездок»; роут /trips/my/:tripId/requests остаётся источником правды,
 * точки входа TripActivePage + TripDetailsPage (DriverSection) — тот же navigate —
 * не меняются).
 *
 * a11y: telegram-ui Modal даёт role=dialog и Esc-закрытие (onOpenChange),
 * focus-trap и возврат фокуса — нативные (Radix FocusScope); свой
 * role=dialog не добавляем (двойной анонс); списки — aria-live,
 * ошибки — role=alert, интерактив — таргеты ≥44px.
 */
export function TripRequestsModal({
  open,
  onClose,
  tripId,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
}) {
  // Фокус, Esc и Tab-trap — нативные (Radix FocusScope + onOpenChange).
  // Имя диалога + видимый заголовок на base: tgui Modal.Header рисует
  // текст только на iOS.
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Заявки пассажиров</Modal.Header>}
      aria-labelledby={titleId}
    >
      <div className={styles.sheetBody}>
        <SheetTitle titleId={titleId}>Заявки пассажиров</SheetTitle>
        <TripRequestsBody tripId={tripId} />
      </div>
    </Modal>
  );
}

/**
 * Роут /trips/my/:tripId/requests: фон — «Поездки» (активный сегмент;
 * вход TripDetailsPage (DriverSection) — тот же путь),
 * поверх — шторка заявок. Закрытие — назад по истории (native Back/Shell
 * backButton через handleModalBack), иначе fallback на
 * /bookings. Путь не меняется.
 */
export function TripRequestsRoute() {
  const navigate = useNavigate();
  const { tripId = "" } = useParams();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/bookings", { replace: true });
  };
  return (
    <>
      <TripPage />
      <TripRequestsModal open onClose={close} tripId={tripId} />
    </>
  );
}

/**
 * Тело заявок пассажиров без PageHeader (закрытие — через header модалки /
 * native Back; внутри модалки back-кнопки нет). Экспортировано для
 * SSR-тестов: Modal — портал, в renderToString не попадает. Мемоизировано
 * (тяжёлые списки заявок).
 */
export const TripRequestsBody = memo(function TripRequestsBody({
  tripId,
}: {
  tripId: string;
}) {
  const navigate = useNavigate();
  const requests = useTripBookingsQuery(tripId);
  const update = useUpdateBookingStatusMutation();
  const { isOnline } = useOnlineStatus();
  const [confirm, setConfirm] = useState<{
    booking: TripBooking;
    action: DriverBookingAction;
  } | null>(null);
  // Нативный Back закрывает окно подтверждения, а не страницу.
  // Колбэк стабилен (иначе стек modalBack пересобирался бы каждый рендер).
  const closeConfirm = useCallback(() => setConfirm(null), []);
  useModalBack(closeConfirm, confirm !== null);

  const items = useMemo(
    () => requests.data?.pages.flatMap((page) => page.items) ?? [],
    [requests.data],
  );
  const pending = useMemo(
    () => items.filter((booking) => booking.status === "pending"),
    [items],
  );
  const confirmed = useMemo(
    () => items.filter((booking) => booking.status === "confirmed"),
    [items],
  );

  if (requests.isLoading) {
    return (
      <Placeholder>
        <span role="status" aria-label="Загрузка">
          <Spinner size="m" />
        </span>
      </Placeholder>
    );
  }

  if (requests.isError) {
    const forbidden = isAuthorizationError(requests.error);
    return (
      <>
        <OfflineBanner />
        <Placeholder
          header={forbidden ? "Нет доступа" : "Не удалось загрузить заявки"}
          description={
            forbidden
              ? "Заявки видит только водитель поездки."
              : bookingErrorMessage(requests.error)
          }
          action={
            <>
              {!forbidden && (
                <Button
                  mode="bezeled"
                  stretched
                  onClick={() => void requests.refetch()}
                >
                  Повторить
                </Button>
              )}
              <Button
                mode="outline"
                stretched
                onClick={() => navigate("/bookings?segment=driver")}
              >
                К моим поездкам
              </Button>
            </>
          }
        >
          {!isOnline && <p>Проверьте подключение к интернету.</p>}
        </Placeholder>
      </>
    );
  }

  return (
    <section aria-label="Заявки пассажиров">
      <OfflineBanner />
      <div className={styles.stack}>
        {update.error && (
          <Caption
            Component="p"
            role="alert"
            className={styles.errorText}
          >
            {bookingErrorMessage(update.error)}
          </Caption>
        )}
        {!items.length && <Placeholder header="Заявок нет" />}
        {pending.length > 0 && (
          <div
            className={styles.list}
            aria-live="polite"
            aria-label="Ожидают решения"
          >
            <Caption weight="2" Component="span" className={styles.groupLabel}>
              {`Ожидают решения (${pending.length})`}
            </Caption>
            {pending.map((booking) => (
              <PendingBookingCard
                key={booking.id}
                booking={booking}
                pending={update.isPending}
                onAccept={() => {
                  haptic.light();
                  setConfirm({ booking, action: "confirmed" });
                }}
                onDecline={() => {
                  haptic.light();
                  setConfirm({ booking, action: "declined" });
                }}
              />
            ))}
          </div>
        )}
        {confirmed.length > 0 && (
          <div className={styles.list} aria-label="Подтверждены">
            <Caption weight="2" Component="span" className={styles.groupLabel}>
              {`Подтверждены (${confirmed.length})`}
            </Caption>
            {confirmed.map((booking) => (
              <ConfirmedBookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        )}
        {requests.hasNextPage && (
          <Button
            stretched
            mode="bezeled"
            className="min-h-11"
            loading={requests.isFetchingNextPage}
            disabled={requests.isFetchingNextPage}
            onClick={() => void requests.fetchNextPage()}
          >
            Показать ещё
          </Button>
        )}
        <Button
          mode="bezeled"
          stretched
          className="min-h-11"
          onClick={() => navigate("/bookings?segment=driver")}
        >
          К моим поездкам
        </Button>
      </div>
      {confirm && (
        <RequestConfirmDialog
          booking={confirm.booking}
          action={confirm.action}
          open
          pending={update.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const { booking, action } = confirm;
            setConfirm(null);
            haptic.light();
            update.mutate(
              { id: booking.id, status: action },
              {
                onSuccess: () => haptic.success(),
                onError: () => haptic.error(),
              },
            );
          }}
        />
      )}
    </section>
  );
});
