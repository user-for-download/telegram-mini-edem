import { useState } from "react";
import {
  Caption,
  Text,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { Chip } from "@/ui/Chip";
import { Notice } from "@/ui/Notice";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { QueryState } from "@/components/QueryState";
import { BTN_ROW_WRAP, GROW, ROW_BETWEEN, TRUNCATE } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";

import { Phone, Send, ShieldCheck, Star } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { useToast } from "@/components/Toast/ToastProvider";
import { EditTripForm } from "@/components/Trip/EditTripForm";
import { LazyAvatar } from "@/components/LazyAvatar";
import { ApiError } from "@/api/client";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Stack } from "@/ui/Stack";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { TripRouteTimeline } from "@/components/TripRouteTimeline";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { shareTrip } from "@/helpers/tripShare";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useAuthStore } from "@/store/useAuthStore";
import { TRIP_KEYS, useTripDetailQuery } from "@/queries/useTripsQuery";
import {
  useCancelBookingMutation,
  useCreateBookingMutation,
  useTripBookingsQuery,
} from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useCompleteTripMutation,
} from "@/queries/useTripsQuery";
import { dayLabel, formatArrivalTime, formatDuration } from "@/utils/date";
import styles from "./TripDetailsPage.module.css";

function formatDurationLocal(minutes: number): string {
  return formatDuration(minutes);
}

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
 */
export function TripDetailsPage() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const trip = useTripDetailQuery(tripId);
  const createBooking = useCreateBookingMutation();
  const cancelBooking = useCancelBookingMutation();
  const user = useAuthStore((state) => state.user);
  const { isOnline } = useOnlineStatus();
  const toast = useToast();
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  // Снимок «сейчас» на момент монтирования (lazy-инициализатор — Date.now()
  // напрямую в рендере запрещён react-hooks/purity). Дрейф за время viewing
  // безвреден: бэкенд всё равно режет точку невозврата (TRIP_IN_PAST).
  // NB: хук обязан стоять до ранних return (rules-of-hooks).
  const [now] = useState(() => Date.now());

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
        <OfflineBanner />
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
  const isDriver = item.driver.id === user?.id;
  const departureTime = item.departureAt
    ? new Date(item.departureAt).getTime()
    : null;
  const departed = departureTime !== null && departureTime <= now;
  const isActive = !item.status || item.status === "active";
  const hasActiveBooking =
    !!item.myBooking &&
    item.myBooking.status !== "cancelled" &&
    item.myBooking.status !== "declined";
  const isConfirmedBooking = item.myBooking?.status === "confirmed";
  // Телефон водителя (F1): сервер отдаёт его только подтверждённому
  // пассажиру (и водителю). Pending-заявитель видит disabled-хинт,
  // посторонние — ничего.
  const canBook =
    !isDriver &&
    isActive &&
    item.seatsAvailable > 0 &&
    !hasActiveBooking &&
    departureTime !== null &&
    departureTime > now;

  const takenSeats = item.bookedSeats ?? [];
  const availableSeats = Array.from(
    { length: item.seatsTotal },
    (_, index) => index + 1,
  ).filter((seat) => !takenSeats.includes(seat));
  const effectiveSeat =
    selectedSeat !== null && !takenSeats.includes(selectedSeat)
      ? selectedSeat
      : (availableSeats[0] ?? null);

  const canCompleteTrip =
    isDriver && isActive && departureTime !== null && departureTime <= now;
  const arrival = formatArrivalTime(item.time, item.durationMinutes);

  const handleShare = () => {
    setShareStatus(null);
    void shareTrip(item.id).then((result) => {
      if (result === "shared")
        setShareStatus("Ссылка отправлена — поделитесь поездкой с попутчиками");
      else if (result === "copied")
        setShareStatus(
          "Ссылка скопирована — поделитесь поездкой с попутчиками",
        );
      else
        setShareStatus(
          "Не удалось поделиться — скопируйте адрес страницы вручную",
        );
      hapticFeedback.notificationOccurred.ifAvailable("success");
    });
  };

  return (
    <Stack>
      <OfflineBanner />

      {hasActiveBooking && item.myBooking && (
        <Notice tone="success" variant="banner">
          <div>
            <Text weight="2" Component="div" className={styles.success}>
              Вы записались попутчиком
            </Text>
            <Caption Component="div" className={styles.successMuted}>
              Место №{item.myBooking.seat} · {item.price} ₽
            </Caption>
          </div>
          <StatusPill
            tone={item.myBooking.status === "confirmed" ? "success" : "warning"}
          >
            {item.myBooking.status === "confirmed"
              ? "Подтверждено"
              : "На рассмотрении"}
          </StatusPill>
        </Notice>
      )}

      <div className={styles.routeCard}>
        <Caption className={ROW_BETWEEN} Component="div">
          <span>{dayLabel(item.date)}</span>
          <span>
            В пути ~ {formatDurationLocal(item.durationMinutes)} ·{" "}
            {item.distanceKm} км
          </span>
        </Caption>

        <TripRouteTimeline
          fromCity={item.fromCity}
          fromAddress={item.fromAddress}
          fromTime={item.time}
          toCity={item.toCity}
          toAddress={item.toAddress}
          arrival={arrival}
        />
      </div>

      <div className={styles.driverCard}>
        <div className={styles.driverRow}>
          <LazyAvatar
            size={40}
            src={item.driver.avatar}
            acronym={item.driver.name.slice(0, 1).toUpperCase()}
            alt={item.driver.name}
          />
          <div className={GROW}>
            <Text weight="2" Component="div" className={styles.nameRow}>
              <span className={TRUNCATE}>{item.driver.name}</span>
              {item.driver.isVerified && (
                <ShieldCheck size={15} className={styles.verified} />
              )}
            </Text>
            <Caption Component="div" className={styles.ratingRow}>
              <Star size={12} className={styles.star} />
              <span>{item.driver.rating.toFixed(1)}</span>
              <span>({item.driver.reviewsCount} отзывов)</span>
            </Caption>
          </div>
        </div>

        <div className={styles.driverActions}>
          <IconButton
            size="m"
            variant="muted"
            onClick={handleShare}
            aria-label="Поделиться поездкой"
            title="Поделиться поездкой"
          >
            <Send size={16} />
          </IconButton>
          {item.driver.phone && isConfirmedBooking ? (
            <IconButton
              size="m"
              variant="muted"
              aria-label={`Позвонить водителю: ${item.driver.phone}`}
              title={item.driver.phone}
              onClick={() => {
                hapticFeedback.impactOccurred.ifAvailable("light");
                window.location.assign(`tel:${item.driver.phone}`);
              }}
            >
              <Phone size={16} />
            </IconButton>
          ) : (
            hasActiveBooking &&
            !isConfirmedBooking && (
              <IconButton
                size="m"
                variant="muted"
                disabled
                title="Телефон водителя доступен после подтверждения"
                aria-label="Телефон водителя доступен после подтверждения"
              >
                <Phone size={16} />
              </IconButton>
            )
          )}
        </div>
      </div>

      {/* Кнопка + статус — плотный стек (ритм 4px): статус сидит
          вплотную к кнопке без отрицательного марджина (было .pullUp
          margin-top:-8px поверх ритма 12 — те же 4px, U3). */}
      <Stack gap="2xs">
        <Button
          size="m"
          stretched
          before={<Send size={16} />}
          onClick={handleShare}
        >
          Поделиться поездкой с попутчиком в Telegram
        </Button>
        {shareStatus && (
          <Caption Component="p" role="status">
            {shareStatus}
          </Caption>
        )}
      </Stack>

      {item.driver.car && (
        <div className={styles.carRow}>
          <Text weight="2" Component="span">
            {item.driver.car.model} · {item.driver.car.color}
          </Text>
          <Caption Component="span">
            {item.driver.car.plate ?? "Госномер после брони"}
          </Caption>
        </div>
      )}

      {item.tags.length > 0 && (
        <div className={BTN_ROW_WRAP}>
          {item.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      )}

      {item.comment && (
        <div className={styles.noteCard}>
          <Caption weight="2" Component="span" className={styles.noteTitle}>
            Комментарий водителя:
          </Caption>
          {item.comment}
        </div>
      )}

      {item.myBooking && (
        <div className={styles.section}>
          {(item.myBooking.status === "pending" ||
            item.myBooking.status === "confirmed") && (
            <ConfirmPopup
              label="Отменить бронирование"
              confirmLabel="Отменить бронь"
              description="Заявка будет отменена, а место снова станет доступно."
              pending={cancelBooking.isPending}
              destructive
              onConfirm={() =>
                cancelBooking.mutate(item.myBooking!.id, {
                  onSuccess: () =>
                    hapticFeedback.notificationOccurred.ifAvailable("success"),
                })
              }
            />
          )}
          {cancelBooking.error && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(cancelBooking.error)}
            </Notice>
          )}
        </div>
      )}

      {canBook && (
        <div className={styles.sectionLoose}>
          <div role="group" aria-label="Выбор места">
            <Text weight="2" Component="p" className={styles.subtitle}>
              Место
            </Text>
            <div className={styles.seatGrid}>
              {Array.from(
                { length: item.seatsTotal },
                (_, index) => index + 1,
              ).map((seat) =>
                takenSeats.includes(seat) ? (
                  <Button
                    key={seat}
                    variant="outline"
                    disabled
                    aria-label={`Место ${seat} занято`}
                  >
                    {seat} (зан.)
                  </Button>
                ) : effectiveSeat === seat ? (
                  <Button
                    key={seat}
                    disabled={createBooking.isPending}
                    onClick={() => setSelectedSeat(seat)}
                    aria-pressed
                    aria-label={`Место ${seat} выбрано`}
                  >
                    {seat}
                  </Button>
                ) : (
                  <Button
                    key={seat}
                    variant="outline"
                    disabled={createBooking.isPending}
                    onClick={() => setSelectedSeat(seat)}
                    aria-pressed={false}
                    aria-label={`Выбрать место ${seat}`}
                  >
                    {seat}
                  </Button>
                ),
              )}
            </div>
          </div>
          <Field label="Комментарий водителю" id="booking-comment">
            {(field) => (
              <Textarea
                {...field}
                value={comment}
                maxLength={300}
                rows={3}
                placeholder="Например: буду с небольшим чемоданом, подойду к 9:25"
                onChange={(event) => setComment(event.target.value)}
              />
            )}
          </Field>
          <div className={styles.priceRow}>
            <div>
              <Caption Component="div">Цена за место</Caption>
              <Text weight="2" Component="div">
                {item.price} ₽
              </Text>
            </div>
            <Caption Component="div" className={styles.payHint}>
              Оплата водителю
              <br />
              при посадке
            </Caption>
          </div>
          <Button
            size="l"
            stretched
            loading={createBooking.isPending}
            disabled={effectiveSeat === null || createBooking.isPending}
            onClick={() => {
              if (effectiveSeat === null) return;
              createBooking.mutate(
                {
                  tripId: item.id,
                  seat: effectiveSeat,
                  comment: comment.trim() ? comment.trim() : undefined,
                },
                {
                  onSuccess: () => {
                    hapticFeedback.notificationOccurred.ifAvailable("success");
                    setComment("");
                    toast.show({
                      text: "Место успешно забронировано",
                      description: "Ожидайте подтверждения от водителя",
                    });
                  },
                  onError: (error) => {
                    // Гонка за место: обновляем схему мест с сервера.
                    if (
                      error instanceof ApiError &&
                      error.code === "SEAT_TAKEN"
                    ) {
                      void queryClient.invalidateQueries({
                        queryKey: TRIP_KEYS.detail(item.id),
                      });
                    }
                  },
                },
              );
            }}
          >
            {effectiveSeat !== null
              ? `Забронировать место №${effectiveSeat} · ${item.price} ₽`
              : "Забронировать место"}
          </Button>
          {createBooking.error && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(createBooking.error)}
            </Notice>
          )}
        </div>
      )}

      {!isDriver &&
        isActive &&
        !departed &&
        item.seatsAvailable <= 0 &&
        !hasActiveBooking && (
          <EmptyState
            header={EMPTY_STATES.tripNoSeats.header}
            description={EMPTY_STATES.tripNoSeats.description}
          />
        )}
      {!isDriver && isActive && departed && (
        <EmptyState
          header={EMPTY_STATES.tripDeparted.header}
          description={EMPTY_STATES.tripDeparted.description}
        />
      )}
      {item.status === "cancelled" && (
        <EmptyState header={EMPTY_STATES.tripCancelled.header} />
      )}
      {item.status === "completed" && (
        <EmptyState header={EMPTY_STATES.tripCompleted.header} />
      )}

      {isDriver && (
        <DriverBlock
          tripId={item.id}
          status={item.status}
          isActive={isActive}
          canCompleteTrip={canCompleteTrip}
          editing={editing}
          onToggleEdit={() => setEditing((value) => !value)}
          trip={item}
        />
      )}
    </Stack>
  );
}

function DriverBlock({
  tripId,
  status,
  isActive,
  canCompleteTrip,
  editing,
  onToggleEdit,
  trip,
}: {
  tripId: string;
  status: string | undefined;
  isActive: boolean;
  canCompleteTrip: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  trip: Parameters<typeof EditTripForm>[0]["trip"];
}) {
  const navigate = useNavigate();
  const cancelTrip = useCancelTripMutation();
  const completeTrip = useCompleteTripMutation();
  // Заявки видны только водителю: остальным бэкенд вернёт 403,
  // поэтому запрос делаем только здесь.
  const bookings = useTripBookingsQuery(tripId, { enabled: isActive });
  const pendingCount =
    bookings.data?.pages
      .flatMap((page) => page.items)
      .filter((booking) => booking.status === "pending").length ?? 0;

  return (
    <div className={styles.section}>
      <Text weight="2" Component="div">
        Управление поездкой
      </Text>
      {status === "completed" && (
        <Caption Component="p">
          Поездка завершена — пассажиры могут оставить отзыв.
        </Caption>
      )}
      {status === "cancelled" && (
        <Caption Component="p">
          Поездка отменена — недоступна для бронирования.
        </Caption>
      )}
      {isActive && (
        <>
          <Button
            stretched
            onClick={() => navigate(`/trips/my/${tripId}/requests`)}
          >
            Заявки пассажиров{bookings.data ? ` (${pendingCount})` : ""}
          </Button>
          {bookings.isError && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(bookings.error)}{" "}
              <Button
                variant="ghost"
                size="s"
                onClick={() => void bookings.refetch()}
              >
                Повторить
              </Button>
            </Notice>
          )}
          <Button stretched onClick={onToggleEdit}>
            {editing ? "Скрыть редактирование" : "Редактировать поездку"}
          </Button>
          {editing && <EditTripForm trip={trip} onDone={onToggleEdit} />}
          <ConfirmPopup
            label="Завершить поездку"
            confirmLabel="Завершить"
            description="Поездка будет перенесена в архив, а пассажиры смогут оставить отзывы."
            pending={completeTrip.isPending}
            disabled={
              !canCompleteTrip || completeTrip.isPending || cancelTrip.isPending
            }
            onConfirm={() => completeTrip.mutate(tripId)}
          />
          {!canCompleteTrip && (
            <p className={styles.hintXs}>
              Завершение станет доступно после времени отправления.
            </p>
          )}
          <ConfirmPopup
            label="Отменить поездку"
            confirmLabel="Отменить поездку"
            description="Поездка станет недоступна, а пассажиры получат уведомление об отмене."
            pending={cancelTrip.isPending}
            destructive
            onConfirm={() => cancelTrip.mutate(tripId)}
          />
          {(cancelTrip.error || completeTrip.error) && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(cancelTrip.error ?? completeTrip.error)}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
