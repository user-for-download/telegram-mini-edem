import { useState } from "react";
import { Button, Chip, IconButton, Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { Phone, Send, ShieldCheck, Star } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { ConfirmAction } from "@/components/ConfirmAction";
import { EditTripForm } from "@/components/EditTripForm";
import { LazyAvatar } from "@/components/LazyAvatar";
import { OfflineBanner } from "@/components/OfflineBanner";
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

function formatDurationLocal(minutes: number): string {
  return formatDuration(minutes);
}

/**
 * Детали поездки — язык TripDetailsModal эталона
 * (/tmp/edem---telegram-mini-app): баннер брони, карточка маршрута
 * с таймлайном, карточка водителя, шаринг, авто, чипы-теги,
 * комментарий, футер бронирования. Логика (места/комментарий/
 * guards/маски адресов/edit trip) — наша, без изменений.
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
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  if (trip.isLoading) {
    return (
      <Placeholder>
        <Spinner size="m" />
      </Placeholder>
    );
  }
  if (trip.isError || !trip.data) {
    return (
      <>
        <OfflineBanner />
        <Placeholder
          header="Поездка не найдена"
          description={trip.error ? bookingErrorMessage(trip.error) : "Вернитесь к поиску и выберите другую поездку."}
        >
          <div className="ButtonRow">
            <Button onClick={() => void trip.refetch()}>Повторить</Button>
            <Button mode="outline" onClick={() => navigate("/trips")}>К поиску</Button>
          </div>
          {!isOnline && <p>Проверьте подключение к интернету.</p>}
        </Placeholder>
      </>
    );
  }

  const item = trip.data;
  const isDriver = item.driver.id === user?.id;
  const departureTime = item.departureAt ? new Date(item.departureAt).getTime() : null;
  const departed = departureTime !== null && departureTime <= Date.now();
  const isActive = !item.status || item.status === "active";
  const hasActiveBooking =
    !!item.myBooking &&
    item.myBooking.status !== "cancelled" &&
    item.myBooking.status !== "declined";
  const canBook =
    !isDriver &&
    isActive &&
    item.seatsAvailable > 0 &&
    !hasActiveBooking &&
    departureTime !== null &&
    departureTime > Date.now();

  const takenSeats = item.bookedSeats ?? [];
  const availableSeats = Array.from({ length: item.seatsTotal }, (_, index) => index + 1).filter(
    (seat) => !takenSeats.includes(seat),
  );
  const effectiveSeat =
    selectedSeat !== null && !takenSeats.includes(selectedSeat)
      ? selectedSeat
      : (availableSeats[0] ?? null);

  const canCompleteTrip = isDriver && isActive && departureTime !== null && departureTime <= Date.now();
  const arrival = formatArrivalTime(item.time, item.durationMinutes);

  const handleShare = () => {
    setShareStatus(null);
    void shareTrip(item.id).then((result) => {
      if (result === "shared") setShareStatus("Ссылка отправлена — поделитесь поездкой с попутчиками");
      else if (result === "copied") setShareStatus("Ссылка скопирована — поделитесь поездкой с попутчиками");
      else setShareStatus("Не удалось поделиться — скопируйте адрес страницы вручную");
      hapticFeedback.notificationOccurred.ifAvailable("success");
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <OfflineBanner />

      {hasActiveBooking && item.myBooking && (
        <div className="p-3 rounded-xl bg-(--app-success-bg) border border-(--app-success)/20 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-(--app-success)">
            Вы записались попутчиком
            <div className="text-[11px] font-medium text-(--app-success)/80">
              Место №{item.myBooking.seat} · {item.price * item.myBooking.seat} ₽
            </div>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-(--app-success) text-white font-medium shrink-0">
            {item.myBooking.status === "confirmed" ? "Подтверждено" : "На рассмотрении"}
          </span>
        </div>
      )}

      <div className="p-3.5 rounded-2xl bg-(--tgui--tertiary_bg_color) flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs font-medium text-(--tgui--hint_color)">
          <span>{dayLabel(item.date)}</span>
          <span>
            В пути ~ {formatDurationLocal(item.durationMinutes)} · {item.distanceKm} км
          </span>
        </div>

        <div className="flex flex-col gap-3 relative pl-4 border-l-2 border-(--app-info) ml-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-(--tgui--text_color)">
                {item.time}
              </span>
              <span className="text-sm font-semibold text-(--tgui--text_color)">
                {item.fromCity}
              </span>
            </div>
            <div className="text-xs text-(--tgui--hint_color) mt-0.5">
              {item.fromAddress ?? "Точное место встречи станет доступно после подтверждения брони"}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              {arrival && (
                <span className="text-base font-bold text-(--tgui--text_color)">
                  {arrival}
                </span>
              )}
              <span className="text-sm font-semibold text-(--tgui--text_color)">
                {item.toCity}
              </span>
            </div>
            <div className="text-xs text-(--tgui--hint_color) mt-0.5">
              {item.toAddress ?? "Точное место встречи станет доступно после подтверждения брони"}
            </div>
          </div>
        </div>
      </div>

      <div className="p-3.5 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <LazyAvatar
            size={40}
            src={item.driver.avatar}
            acronym={item.driver.name.slice(0, 1).toUpperCase()}
            alt={item.driver.name}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-semibold text-sm text-(--tgui--text_color)">
              <span className="truncate">{item.driver.name}</span>
              {item.driver.isVerified && (
                <ShieldCheck size={15} className="text-(--app-info) fill-(--app-info-bg) shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-(--tgui--hint_color)">
              <Star size={12} className="fill-(--app-rating) text-(--app-rating)" />
              <span>{item.driver.rating.toFixed(1)}</span>
              <span>({item.driver.reviewsCount} отзывов)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <IconButton
            size="m"
            mode="gray"
            onClick={handleShare}
            aria-label="Поделиться поездкой"
            title="Поделиться поездкой"
          >
            <Send size={16} />
          </IconButton>
          {hasActiveBooking && (
            <span
              className="p-2 rounded-full bg-(--tgui--secondary_fill) text-(--tgui--hint_color) min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="Телефон водителя доступен после подтверждения"
            >
              <Phone size={16} />
            </span>
          )}
        </div>
      </div>

      <Button
        mode="bezeled"
        size="m"
        stretched
        before={<Send size={16} />}
        onClick={handleShare}
      >
        Поделиться поездкой с попутчиком в Telegram
      </Button>
      {shareStatus && (
        <p role="status" className="text-xs text-(--tgui--hint_color) -mt-2">
          {shareStatus}
        </p>
      )}

      {item.driver.car && (
        <div className="p-3 rounded-xl bg-(--tgui--tertiary_bg_color) flex items-center justify-between text-xs">
          <span className="font-semibold text-(--tgui--text_color)">
            {item.driver.car.model} · {item.driver.car.color}
          </span>
          <span className="text-(--tgui--hint_color)">
            {item.driver.car.plate ?? "Госномер после брони"}
          </span>
        </div>
      )}

      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <Chip key={tag} mode="mono">
              {tag}
            </Chip>
          ))}
        </div>
      )}

      {item.comment && (
        <div className="p-3 rounded-xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) text-xs text-(--tgui--text_color) leading-relaxed">
          <span className="font-semibold text-(--tgui--hint_color) block mb-0.5">
            Комментарий водителя:
          </span>
          {item.comment}
        </div>
      )}

      {item.myBooking && (
        <div className="flex flex-col gap-2 pt-2 border-t border-(--tgui--outline)">
          {(item.myBooking.status === "pending" || item.myBooking.status === "confirmed") && (
            <ConfirmAction
              label="Отменить бронирование"
              confirmLabel="Отменить бронь"
              description="Заявка будет отменена, а место снова станет доступно."
              pending={cancelBooking.isPending}
              onConfirm={() =>
                cancelBooking.mutate(item.myBooking!.id, {
                  onSuccess: () =>
                    hapticFeedback.notificationOccurred.ifAvailable("success"),
                })
              }
            />
          )}
          {cancelBooking.error && (
            <p className="FormError" role="alert">
              {bookingErrorMessage(cancelBooking.error)}
            </p>
          )}
        </div>
      )}

      {canBook && (
        <div className="flex flex-col gap-3 pt-2 border-t border-(--tgui--outline)">
          <div role="group" aria-label="Выбор места">
            <p className="text-sm font-medium text-(--tgui--text_color) mb-2">Место</p>
            <div className="ButtonRow">
              {Array.from({ length: item.seatsTotal }, (_, index) => index + 1).map((seat) =>
                takenSeats.includes(seat) ? (
                  <Button key={seat} mode="outline" disabled aria-label={`Место ${seat} занято`}>
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
                    mode="outline"
                    disabled={createBooking.isPending}
                    onClick={() => setSelectedSeat(seat)}
                    aria-pressed={false}
                    aria-label={`Выбрать место ${seat}`}
                  >
                    {seat}
                  </Button>
                )
              )}
            </div>
          </div>
          <label className="FormField">
            Комментарий водителю
            <textarea
              value={comment}
              maxLength={300}
              rows={3}
              placeholder="Например: буду с небольшим чемоданом, подойду к 9:25"
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-xs text-(--tgui--hint_color)">
                Цена за место
              </div>
              <div className="text-xl font-bold text-(--tgui--text_color)">
                {item.price} ₽
              </div>
            </div>
            <div className="text-right text-[11px] text-(--tgui--hint_color)">
              Оплата водителю
              <br />при посадке
            </div>
          </div>
          <Button
            mode="filled"
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
                  },
                  onError: (error) => {
                    // Гонка за место: обновляем схему мест с сервера.
                    if (
                      error instanceof Error &&
                      "code" in error &&
                      (error as { code?: string }).code === "SEAT_TAKEN"
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
            Забронировать место · {item.price} ₽
          </Button>
          {createBooking.error && (
            <p className="FormError" role="alert">
              {bookingErrorMessage(createBooking.error)}
            </p>
          )}
        </div>
      )}

      {!isDriver && isActive && !departed && item.seatsAvailable <= 0 && !hasActiveBooking && (
        <Placeholder header="Свободных мест нет" description="Попробуйте другую поездку или оставьте запрос попутчика." />
      )}
      {!isDriver && isActive && departed && (
        <Placeholder header="Поездка уже отправилась" description="Бронирование недоступно. Найдите другую поездку." />
      )}
      {item.status === "cancelled" && <Placeholder header="Поездка отменена" />}
      {item.status === "completed" && <Placeholder header="Поездка завершена" />}

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
    </div>
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
  // поэтому запрос делаем только здесь (паттерн VK TripDetailsPanel).
  const bookings = useTripBookingsQuery(tripId, { enabled: isActive });
  const pendingCount =
    bookings.data?.pages
      .flatMap((page) => page.items)
      .filter((booking) => booking.status === "pending").length ?? 0;

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-(--tgui--outline)">
      <div className="text-sm font-semibold text-(--tgui--text_color)">
        Управление поездкой
      </div>
      {status === "completed" && (
        <p className="text-xs text-(--tgui--hint_color)">Поездка завершена — пассажиры могут оставить отзыв.</p>
      )}
      {status === "cancelled" && (
        <p className="text-xs text-(--tgui--hint_color)">Поездка отменена — недоступна для бронирования.</p>
      )}
      {isActive && (
        <>
          <Button mode="bezeled" stretched onClick={() => navigate(`/trips/my/${tripId}/requests`)}>
            Заявки пассажиров{bookings.data ? ` (${pendingCount})` : ""}
          </Button>
          {bookings.isError && (
            <p className="FormError" role="alert">
              {bookingErrorMessage(bookings.error)}{" "}
              <Button mode="plain" size="s" onClick={() => void bookings.refetch()}>
                Повторить
              </Button>
            </p>
          )}
          <Button mode="bezeled" stretched onClick={onToggleEdit}>
            {editing ? "Скрыть редактирование" : "Редактировать поездку"}
          </Button>
          {editing && <EditTripForm trip={trip} onDone={onToggleEdit} />}
          <ConfirmAction
            label="Завершить поездку"
            confirmLabel="Завершить"
            description="Поездка будет перенесена в архив, а пассажиры смогут оставить отзывы."
            pending={completeTrip.isPending}
            disabled={!canCompleteTrip || completeTrip.isPending || cancelTrip.isPending}
            onConfirm={() => completeTrip.mutate(tripId)}
          />
          {!canCompleteTrip && (
            <p className="text-xs text-(--tgui--hint_color)">Завершение станет доступно после времени отправления.</p>
          )}
          <ConfirmAction
            label="Отменить поездку"
            confirmLabel="Отменить поездку"
            description="Поездка станет недоступна, а пассажиры получат уведомление об отмене."
            pending={cancelTrip.isPending}
            onConfirm={() => cancelTrip.mutate(tripId)}
          />
          {(cancelTrip.error || completeTrip.error) && (
            <p className="FormError" role="alert">
              {bookingErrorMessage(cancelTrip.error ?? completeTrip.error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
