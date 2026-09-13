import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Button,
  Modal,
  Placeholder,
  Spinner,
} from "@telegram-apps/telegram-ui";
import { useNavigate, useParams } from "react-router-dom";
import { LazyAvatar } from "@/components/LazyAvatar";
import { OfflineBanner } from "@/components/OfflineBanner";
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
    <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LazyAvatar
            size={40}
            src={booking.passenger.avatar}
            acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
            alt={booking.passenger.name}
          />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[var(--tgui--text_color)] truncate">
              {booking.passenger.name}
            </div>
            <div className="text-[11px] text-[var(--tgui--hint_color)]">
              {`место ${booking.seat}${booking.comment ? ` · «${booking.comment}»` : ""}`}
            </div>
          </div>
        </div>
        <span className="StatusPill shrink-0" data-tone="warning">
          Ожидает решения
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          stretched
          size="s"
          className="min-h-[44px]"
          disabled={pending}
          onClick={() => onAccept(booking.id)}
        >
          Принять
        </Button>
        <Button
          mode="bezeled"
          stretched
          size="s"
          className="min-h-[44px]"
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
    <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <LazyAvatar
          size={40}
          src={booking.passenger.avatar}
          acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
          alt={booking.passenger.name}
        />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[var(--tgui--text_color)] truncate">
            {booking.passenger.name}
          </div>
          <div className="text-[11px] text-[var(--tgui--hint_color)]">
            {`место ${booking.seat}`}
          </div>
        </div>
      </div>
      <span className="StatusPill shrink-0" data-tone="success">
        Подтверждён
      </span>
    </div>
  );
});

/**
 * Заявки пассажиров — модальная шторка поверх «Поездок» (модель примера:
 * CreateTripModal/ReviewsModal; в Telegram нет «новых страниц», только
 * модалки; роут /trips/my/:tripId/requests остаётся источником правды,
 * точки входа TripsPage:425 + TripDetailsPage:347 — тот же navigate —
 * не меняются).
 *
 * a11y: telegram-ui Modal даёт role=dialog и Esc-закрытие (onOpenChange);
 * дублируем Esc-хендлер + лёгкий focus-trap (паттерн ReviewsModal),
 * списки — aria-live, ошибки — role=alert, интерактив — таргеты ≥44px.
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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc закрывает шторку (a11y); native Back обрабатывает Shell.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Фокус внутрь диалога при открытии (Modal держит портал).
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Лёгкий focus-trap: Tab циклится внутри диалога.
  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = [
      ...root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Заявки пассажиров</Modal.Header>}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Заявки пассажиров"
        tabIndex={-1}
        onKeyDown={trapTab}
        className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto outline-none"
      >
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
        >
          <div className="ButtonRow">
            {!forbidden && (
              <Button
                className="min-h-[44px]"
                onClick={() => void requests.refetch()}
              >
                Повторить
              </Button>
            )}
            <Button
              mode="outline"
              className="min-h-[44px]"
              onClick={() => navigate("/bookings?segment=driver")}
            >
              К моим поездкам
            </Button>
          </div>
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
          <p className="FormError" role="alert">
            {bookingErrorMessage(update.error)}
          </p>
        )}
        {!items.length && <Placeholder header="Заявок нет" />}
        {pending.length > 0 && (
          <div
            className="flex flex-col gap-3"
            aria-live="polite"
            aria-label="Ожидают решения"
          >
            <span className="text-[13px] font-semibold text-[var(--tgui--hint_color)] px-1">
              {`Ожидают решения (${pending.length})`}
            </span>
            {pending.map((booking) => (
              <PendingBookingCard
                key={booking.id}
                booking={booking}
                pending={update.isPending}
                onAccept={(id) =>
                  update.mutate({ id, status: "confirmed" })
                }
                onDecline={(id) =>
                  update.mutate({ id, status: "declined" })
                }
              />
            ))}
          </div>
        )}
        {confirmed.length > 0 && (
          <div className="flex flex-col gap-3" aria-label="Подтверждены">
            <span className="text-[13px] font-semibold text-[var(--tgui--hint_color)] px-1">
              {`Подтверждены (${confirmed.length})`}
            </span>
            {confirmed.map((booking) => (
              <ConfirmedBookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        )}
        {requests.hasNextPage && (
          <Button
            stretched
            mode="bezeled"
            className="min-h-[44px]"
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
          className="min-h-[44px]"
          onClick={() => navigate("/bookings?segment=driver")}
        >
          К моим поездкам
        </Button>
      </div>
    </section>
  );
});
