import { memo, useMemo } from "react";
import { Caption, Text } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { BTN_ROW, GROW, SHRINK, TRUNCATE } from "@/ui/classes";
import { FetchMore } from "@/ui/FetchMore";
import { Loading } from "@/ui/Loading";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";

import { useNavigate, useParams } from "react-router-dom";
import { LazyAvatar } from "@/components/LazyAvatar";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { haptic } from "@/utils/haptics";
import { TripPage } from "@/pages/Trip/TripPage";
import {
  bookingErrorMessage,
  isAuthorizationError,
} from "@/helpers/bookingErrors";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  useTripBookingsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";
import { Card } from "@/ui/Card";
import { Stack } from "@/ui/Stack";
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
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.rowInfo}>
          <LazyAvatar
            size={40}
            src={booking.passenger.avatar}
            acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
            alt={booking.passenger.name}
          />
          <div className={GROW}>
            <Text Component="div" className={TRUNCATE}>
              {booking.passenger.name}
            </Text>
            <Caption Component="div">
              {`место ${booking.seat}${booking.comment ? ` · «${booking.comment}»` : ""}`}
            </Caption>
          </div>
        </div>
        <StatusPill tone="warning" className={SHRINK}>
          Ожидает решения
        </StatusPill>
      </div>
      <div className={BTN_ROW}>
        <ConfirmPopup
          label="Принять"
          confirmLabel="Подтвердить пассажира?"
          description={`${booking.passenger.name} · место ${booking.seat}`}
          pending={pending}
          className="min-h-11"
          onConfirm={() => onAccept(booking.id)}
        />
        <ConfirmPopup
          label="Отклонить"
          confirmLabel="Отклонить заявку?"
          description={`${booking.passenger.name} · место ${booking.seat}`}
          pending={pending}
          destructive
          className="min-h-11"
          onConfirm={() => onDecline(booking.id)}
        />
      </div>
    </Card>
  );
});

/** Карточка подтверждённого пассажира (только чтение). */
const ConfirmedBookingCard = memo(function ConfirmedBookingCard({
  booking,
}: {
  booking: TripBooking;
}) {
  return (
    <Card className={styles.cardRow}>
      <div className={styles.rowInfo}>
        <LazyAvatar
          size={40}
          src={booking.passenger.avatar}
          acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
          alt={booking.passenger.name}
        />
        <div className={GROW}>
          <Text Component="div" className={TRUNCATE}>
            {booking.passenger.name}
          </Text>
          <Caption Component="div">{`место ${booking.seat}`}</Caption>
        </div>
      </div>
      <StatusPill tone="success" className={SHRINK}>
        Подтверждён
      </StatusPill>
    </Card>
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
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Заявки пассажиров"
    >
      <TripRequestsBody tripId={tripId} />
    </Sheet>
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
  // Per-row pending (как в DriverTripRequests): лоадится только
  // обрабатываемая строка, остальные остаются интерактивными.
  const actingId = update.isPending ? update.variables?.id : undefined;

  if (requests.isLoading) {
    return <Loading />;
  }

  if (requests.isError) {
    const forbidden = isAuthorizationError(requests.error);
    return (
      <>
        <OfflineBanner />
        <EmptyState
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
                  stretched
                  onClick={() => void requests.refetch()}
                >
                  Повторить
                </Button>
              )}
              <Button
                variant="outline"
                stretched
                onClick={() => navigate("/bookings?segment=driver")}
              >
                К моим поездкам
              </Button>
            </>
          }
        >
          {!isOnline && <p>Проверьте подключение к интернету.</p>}
        </EmptyState>
      </>
    );
  }

  return (
    <section aria-label="Заявки пассажиров">
      <OfflineBanner />
      <Stack>
        {update.error && (
          <Notice tone="danger" variant="text">
            {bookingErrorMessage(update.error)}
          </Notice>
        )}
        {!items.length && (
          <EmptyState header={EMPTY_STATES.tripRequestsEmpty.header} />
        )}
        {pending.length > 0 && (
          <Stack aria-live="polite" aria-label="Ожидают решения">
            <Caption weight="2" Component="span" className={styles.groupLabel}>
              {`Ожидают решения (${pending.length})`}
            </Caption>
            {pending.map((booking) => (
              <PendingBookingCard
                key={booking.id}
                booking={booking}
                pending={actingId === booking.id}
                onAccept={() => {
                  haptic.light();
                  update.mutate(
                    { id: booking.id, status: "confirmed" },
                    {
                      onSuccess: () => haptic.success(),
                      onError: () => haptic.error(),
                    },
                  );
                }}
                onDecline={() => {
                  haptic.light();
                  update.mutate(
                    { id: booking.id, status: "declined" },
                    {
                      onSuccess: () => haptic.success(),
                      onError: () => haptic.error(),
                    },
                  );
                }}
              />
            ))}
          </Stack>
        )}
        {confirmed.length > 0 && (
          <Stack aria-label="Подтверждены">
            <Caption weight="2" Component="span" className={styles.groupLabel}>
              {`Подтверждены (${confirmed.length})`}
            </Caption>
            {confirmed.map((booking) => (
              <ConfirmedBookingCard key={booking.id} booking={booking} />
            ))}
          </Stack>
        )}
        <FetchMore
          hasNextPage={requests.hasNextPage}
          isFetchingNextPage={requests.isFetchingNextPage}
          fetchNextPage={() => void requests.fetchNextPage()}
        />
        <Button
          stretched
          onClick={() => navigate("/bookings?segment=driver")}
        >
          К моим поездкам
        </Button>
      </Stack>
    </section>
  );
});
