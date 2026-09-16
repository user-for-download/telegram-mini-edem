import { memo, useMemo } from "react";
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
import { StatusPill } from "@/components/StatusPill";
import { OfflineBanner } from "@/components/OfflineBanner";
import { haptic } from "@/utils/haptics";
import { TripsPage } from "@/pages/TripsPage";
import {
  bookingErrorMessage,
  isAuthorizationError,
} from "@/helpers/bookingErrors";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  useTripBookingsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";

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
    <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LazyAvatar
            size={40}
            src={booking.passenger.avatar}
            acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
            alt={booking.passenger.name}
          />
          <div className="min-w-0">
            <Text Component="div" className="truncate">
              {booking.passenger.name}
            </Text>
            <Caption Component="div">
              {`место ${booking.seat}${booking.comment ? ` · «${booking.comment}»` : ""}`}
            </Caption>
          </div>
        </div>
        <StatusPill tone="warning" className="shrink-0">
          Ожидает решения
        </StatusPill>
      </div>
      <div className="flex gap-2">
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
    <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <LazyAvatar
          size={40}
          src={booking.passenger.avatar}
          acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
          alt={booking.passenger.name}
        />
        <div className="min-w-0">
          <Text Component="div" className="truncate">
            {booking.passenger.name}
          </Text>
          <Caption Component="div">{`место ${booking.seat}`}</Caption>
        </div>
      </div>
      <StatusPill tone="success" className="shrink-0">
        Подтверждён
      </StatusPill>
    </div>
  );
});

/**
 * Заявки пассажиров — route-backed шторка поверх «Поездок»; роут /trips/my/:tripId/requests остаётся источником правды,
 * точки входа TripsPage:425 + TripDetailsPage:347 — тот же navigate —
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
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Заявки пассажиров</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto outline-none">
        <TripRequestsBody tripId={tripId} />
      </div>
    </Modal>
  );
}

/**
 * Роут /trips/my/:tripId/requests: фон — «Поездки» (сегмент водителя,
 * точка входа TripsPage:425; вход TripDetailsPage:347 — тот же путь),
 * поверх — шторка заявок. Закрытие — назад по истории (native Back/Shell
 * backButton через handleModalBack), иначе fallback на
 * /bookings?segment=driver. Путь не меняется.
 */
export function TripRequestsRoute() {
  const navigate = useNavigate();
  const { tripId = "" } = useParams();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/bookings?segment=driver", { replace: true });
  };
  return (
    <>
      <TripsPage />
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
      <div className="flex flex-col gap-3.5 pt-1">
        {update.error && (
          <Caption
            Component="p"
            role="alert"
            className="text-(--tg-theme-destructive-text-color)"
          >
            {bookingErrorMessage(update.error)}
          </Caption>
        )}
        {!items.length && <Placeholder header="Заявок нет" />}
        {pending.length > 0 && (
          <div
            className="flex flex-col gap-3"
            aria-live="polite"
            aria-label="Ожидают решения"
          >
            <Caption weight="2" Component="span" className="px-1">
              {`Ожидают решения (${pending.length})`}
            </Caption>
            {pending.map((booking) => (
              <PendingBookingCard
                key={booking.id}
                booking={booking}
                pending={update.isPending}
                onAccept={(id) =>
                  update.mutate(
                    { id, status: "confirmed" },
                    {
                      onSuccess: () => haptic.success(),
                      onError: () => haptic.error(),
                    },
                  )
                }
                onDecline={(id) =>
                  update.mutate(
                    { id, status: "declined" },
                    {
                      onSuccess: () => haptic.success(),
                      onError: () => haptic.error(),
                    },
                  )
                }
              />
            ))}
          </div>
        )}
        {confirmed.length > 0 && (
          <div className="flex flex-col gap-3" aria-label="Подтверждены">
            <Caption weight="2" Component="span" className="px-1">
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
    </section>
  );
});
