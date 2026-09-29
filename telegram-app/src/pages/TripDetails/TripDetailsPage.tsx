import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Stack } from "@/ui/Stack";
import { QueryState } from "@/components/QueryState";
import { ApiError } from "@/api/client";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useTripDetailQuery } from "@/queries/useTripsQuery";
import { useNavigate, useParams } from "react-router-dom";
import { BookingPanel } from "./BookingPanel";
import { DriverPanel } from "./DriverPanel";
import { TripHero } from "./TripHero";
import { useTripActions } from "./useTripActions";

/**
 * Детали поездки — язык TripDetailsModal эталона
 * (/tmp/edem---telegram-mini-app): баннер брони, карточка маршрута
 * с таймлайном, карточка водителя, шаринг, авто, чипы-теги,
 * комментарий, футер бронирования. Логика (места/комментарий/
 * guards/маски адресов/edit trip) — наша, без изменений.
 *
 * Вложенный экран (контент Sheet TripDetailsModal): корня Page нет —
 * ритм и паддинги даёт SheetBody, двойной List дал бы двойные отступы
 * и 96px клиренса таббара внутри шторки. Состояния — кит: loading и
 * error/empty через QueryState/EmptyState, своих плейсхолдеров нет.
 *
 * Разметка — в TripHero/BookingPanel/DriverPanel, состояние и хендлеры —
 * в useTripActions. Здесь только запрос, ранние return и компоновка.
 */
export function TripDetailsPage() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useOnlineStatus();
  // NB: хук обязан стоять до ранних return (rules-of-hooks) — пока нет
  // данных отдаёт дефолтные флаги, разметка всё равно не рендерится.
  const trip = useTripDetailQuery(tripId);
  const actions = useTripActions(trip.data);

  if (trip.isLoading) {
    return (
      <QueryState
        loading
        error={null}
        empty={false}
        emptyText=""
        onRetry={() => void trip.refetch()}
      >
        {null}
      </QueryState>
    );
  }
  if (trip.isError || !trip.data) {
    // Мёртвый deep link (trip_<uuid> удалённой поездки): ретрай бессмыслен —
    // прячем «Повторить», даём понятный текст и путь к поиску.
    const isNotFound =
      trip.error instanceof ApiError && trip.error.status === 404;
    return (
      <>
        <EmptyState
          header={EMPTY_STATES.tripNotFound.header}
          description={
            isNotFound
              ? EMPTY_STATES.tripNotFoundDeleted.description
              : trip.error
                ? bookingErrorMessage(trip.error)
                : EMPTY_STATES.tripNotFoundHint.description
          }
          action={
            <>
              {!isNotFound && (
                <Button stretched onClick={() => void trip.refetch()}>
                  Повторить
                </Button>
              )}
              <Button
                variant="outline"
                stretched
                onClick={() => navigate("/trips")}
              >
                К поиску
              </Button>
              {!isOnline && <p>Проверьте подключение к интернету.</p>}
            </>
          }
        />
      </>
    );
  }

  const item = trip.data;

  return (
    <Stack>
      <TripHero
        item={item}
        shareStatus={actions.shareStatus}
        isConfirmedBooking={!!actions.isConfirmedBooking}
        hasActiveBooking={actions.hasActiveBooking}
        arrival={actions.arrival}
        onShare={() => actions.handleShare(item.id)}
      />
      <BookingPanel
        item={item}
        isDriver={actions.isDriver}
        isActive={actions.isActive}
        departed={actions.departed}
        hasActiveBooking={actions.hasActiveBooking}
        canBook={actions.canBook}
        effectiveSeat={actions.effectiveSeat}
        takenSeats={actions.takenSeats}
        comment={actions.comment}
        createBooking={actions.createBooking}
        onSelectSeat={actions.setSelectedSeat}
        onCommentChange={actions.setComment}
        onSubmit={actions.submitBooking}
      />
      {actions.isDriver && (
        <DriverPanel
          tripId={item.id}
          status={item.status}
          isActive={actions.isActive}
          canCompleteTrip={actions.canCompleteTrip}
          editing={actions.editing}
          onToggleEdit={actions.toggleEditing}
          trip={item}
        />
      )}
    </Stack>
  );
}
