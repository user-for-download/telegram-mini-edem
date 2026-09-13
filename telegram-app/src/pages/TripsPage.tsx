import { useState } from "react";
import {
  Avatar,
  Button,
  IconButton,
  SegmentedControl,
} from "@telegram-apps/telegram-ui";
import { Calendar, Car, Send, Share2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QueryState } from "@/components/QueryState";
import { ConfirmAction } from "@/components/ConfirmAction";
import { useToast } from "@/components/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { shareTrip } from "@/helpers/tripShare";
import { haptic } from "@/utils/haptics";
import { dayLabel } from "@/utils/date";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import {
  useCancelBookingMutation,
  useMyBookingsQuery,
  usePassengerHistoryQuery,
} from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useCompleteTripMutation,
  useInfiniteMyTripsQuery,
} from "@/queries/useTripsQuery";
import type { Trip } from "@edem/contracts";
import type { PassengerBooking } from "@edem/contracts";

type Segment = "active" | "history" | "driver";

const SEGMENTS: ReadonlyArray<{ value: Segment; label: string }> = [
  { value: "active", label: "Активные" },
  { value: "history", label: "История" },
  { value: "driver", label: "За рулём" },
];

function parseSegment(value: string | null): Segment {
  return value === "history" || value === "driver" ? value : "active";
}

function bookingStatusLabel(status: string): { label: string; tone: string } {
  if (status === "confirmed") return { label: "Подтверждено", tone: "success" };
  if (status === "cancelled") return { label: "Отменено", tone: "danger" };
  if (status === "declined") return { label: "Отклонено", tone: "danger" };
  return { label: "На рассмотрении", tone: "warning" };
}

function tripStatusLabel(trip: Trip): { label: string; tone: string } {
  if (trip.status === "completed") return { label: "Завершена", tone: "info" };
  if (trip.status === "cancelled") return { label: "Отменена", tone: "danger" };
  const pending = trip.pendingRequestsCount ?? 0;
  if (pending > 0) return { label: `Заявки: ${pending}`, tone: "warning" };
  const confirmed = trip.confirmedBookingsCount ?? 0;
  if (confirmed > 0) return { label: `Забронировано: ${confirmed}`, tone: "success" };
  return { label: `Свободно: ${trip.seatsAvailable}`, tone: "info" };
}

/** Маршрутная визуализация (язык примера): города + адреса вдоль линии. */
function RouteLine({ trip }: { trip: Trip }) {
  return (
    <div className="flex flex-col gap-2 relative pl-4 border-l-2 border-[var(--app-info)]/30 ml-2 py-0.5">
      <div>
        <div className="text-[15px] font-bold text-[var(--tgui--text_color)]">
          {trip.fromCity}
        </div>
        {trip.fromAddress && (
          <div className="text-[12px] text-[var(--tgui--hint_color)] truncate">
            {trip.fromAddress}
          </div>
        )}
      </div>
      <div className="pt-1">
        <div className="text-[15px] font-bold text-[var(--tgui--text_color)]">
          {trip.toCity}
        </div>
        {trip.toAddress && (
          <div className="text-[12px] text-[var(--tgui--hint_color)] truncate">
            {trip.toAddress}
          </div>
        )}
      </div>
    </div>
  );
}

/** Карточка активной брони пассажира. */
function ActiveBookingCard({
  booking,
  onCancel,
  pending,
}: {
  booking: PassengerBooking;
  onCancel: (id: string) => void;
  pending: boolean;
}) {
  const navigate = useNavigate();
  const status = bookingStatusLabel(booking.status);
  return (
    <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--tgui--hint_color)] min-w-0">
          <Calendar size={14} className="shrink-0" />
          <span className="truncate">
            {dayLabel(booking.trip.date)}, {booking.trip.time}
          </span>
        </div>
        <span className="StatusPill shrink-0" data-tone={status.tone}>
          {status.label}
        </span>
      </div>

      <RouteLine trip={booking.trip} />

      <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--tgui--tertiary_bg_color)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            size={40}
            src={booking.trip.driver.avatar}
            acronym={booking.trip.driver.name.slice(0, 1).toUpperCase()}
          />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--tgui--text_color)] truncate">
              {booking.trip.driver.name}
            </div>
            <div className="text-[11px] text-[var(--tgui--hint_color)]">
              {`место №${booking.seat}`}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[14px] font-bold text-[var(--tgui--text_color)]">
            {booking.trip.price * booking.seat} ₽
          </div>
          <div className="text-[11px] text-[var(--tgui--hint_color)]">
            {`цена (${booking.seat} ${booking.seat === 1 ? "место" : "места"})`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-[var(--tgui--outline)]">
        <Button
          size="s"
          mode="bezeled"
          className="flex-1"
          onClick={() => {
            haptic.light();
            navigate(`/trips/${booking.trip.id}`);
          }}
        >
          Детали поездки
        </Button>
        <IconButton
          size="s"
          mode="bezeled"
          aria-label="Поделиться поездкой"
          title="Поделиться поездкой"
          onClick={() => {
            haptic.light();
            void shareTrip(booking.trip.id);
          }}
        >
          <Share2 size={15} />
        </IconButton>
        {(booking.status === "pending" || booking.status === "confirmed") && (
          <ConfirmAction
            label="Отменить"
            confirmLabel="Отменить бронь"
            description="Заявка будет отменена, а место снова станет доступно."
            pending={pending}
            onConfirm={() => onCancel(booking.id)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * «Поездки» — один раздел с сегментами Активные / История / За рулём
 * (язык TripsTab примера, адаптация под наши queries): активные брони,
 * история пассажира и поездки водителя с заявками. Сегмент синхронизирован
 * с ?segment= (deep-links/редиректы со старых маршрутов).
 */
export function TripsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const segment = parseSegment(searchParams.get("segment"));
  const [historyFilter, setHistoryFilter] = useState<"all" | "completed" | "cancelled">("all");

  const bookings = useMyBookingsQuery();
  const history = usePassengerHistoryQuery({ enabled: segment === "history" });
  const driverTrips = useInfiniteMyTripsQuery({ enabled: segment === "driver" });
  const cancelBooking = useCancelBookingMutation();
  const cancelTrip = useCancelTripMutation();
  const completeTrip = useCompleteTripMutation();

  const activeBookings = (bookings.data ?? [])
    .filter((booking) => booking.status === "pending" || booking.status === "confirmed")
    .sort((a, b) => {
      const aTime = a.trip.departureAt ? Date.parse(a.trip.departureAt) : 0;
      const bTime = b.trip.departureAt ? Date.parse(b.trip.departureAt) : 0;
      return aTime - bTime;
    });

  const historyItems = (history.data ?? [])
    .filter((booking) => historyFilter === "all" || booking.historyCategory === historyFilter)
    .sort((a, b) => {
      const aTime = a.trip.departureAt ? Date.parse(a.trip.departureAt) : 0;
      const bTime = b.trip.departureAt ? Date.parse(b.trip.departureAt) : 0;
      return bTime - aTime;
    });

  const driverItems = driverTrips.data?.pages.flatMap((page) => page.items) ?? [];

  // Сентинел автодогрузки водительских поездок (тот же
  // useInfiniteMyTripsQuery, контракт не меняется; SSR — тихий фолбэк).
  const driverSentinelRef = useInfiniteSentinel({
    hasNextPage: driverTrips.hasNextPage,
    isFetchingNextPage: driverTrips.isFetchingNextPage,
    fetchNextPage: () => {
      void driverTrips.fetchNextPage();
    },
    disabled: segment !== "driver",
  });

  const pickSegment = (next: Segment) => {
    if (next === segment) return;
    haptic.selection();
    setSearchParams(next === "active" ? {} : { segment: next }, { replace: true });
  };

  const mutationError = cancelBooking.error ?? cancelTrip.error ?? completeTrip.error;

  return (
    <>
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-4">
        <div role="tablist" aria-label="Мои поездки">
          <SegmentedControl>
            {SEGMENTS.map((option) => (
              <SegmentedControl.Item
                key={option.value}
                role="tab"
                selected={segment === option.value}
                aria-selected={segment === option.value}
                onClick={() => pickSegment(option.value)}
              >
                {option.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        </div>

        {mutationError && (
          <p className="FormError" role="alert">
            {bookingErrorMessage(mutationError)}
          </p>
        )}

        {segment === "active" && (
          <QueryState
            loading={bookings.isLoading}
            error={bookings.error}
            empty={activeBookings.length === 0}
            emptyText="Вы ещё не забронировали поездку. Найдите подходящую в поиске!"
            onRetry={() => void bookings.refetch()}
          >
            <div className="flex flex-col gap-3">
              {activeBookings.map((booking) => (
                <ActiveBookingCard
                  key={booking.id}
                  booking={booking}
                  pending={cancelBooking.isPending}
                  onCancel={(id) =>
                    cancelBooking.mutate(id, {
                      onSuccess: () => {
                        haptic.success();
                        toast.show({ text: "Бронь поездки отменена" });
                      },
                    })
                  }
                />
              ))}
              <Button size="l" mode="filled" onClick={() => navigate("/trips")}>
                Найти поездку
              </Button>
            </div>
          </QueryState>
        )}

        {segment === "history" && (
          <QueryState
            loading={history.isLoading}
            error={history.error}
            empty={historyItems.length === 0}
            emptyText={
              historyFilter === "all"
                ? "Здесь появятся завершённые и архивные поездки."
                : "Нет подходящих поездок."
            }
            onRetry={() => void history.refetch()}
          >
            <div role="tablist" aria-label="Фильтр истории" className="mt-1">
              <SegmentedControl>
                {(["all", "completed", "cancelled"] as const).map((value) => (
                  <SegmentedControl.Item
                    key={value}
                    role="tab"
                    selected={historyFilter === value}
                    aria-selected={historyFilter === value}
                    onClick={() => {
                      haptic.selection();
                      setHistoryFilter(value);
                    }}
                  >
                    {value === "all" ? "Все" : value === "completed" ? "Завершённые" : "Отменённые"}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl>
            </div>
            <div className="flex flex-col gap-3 mt-1">
              {historyItems.map((booking) => {
                const category = booking.historyCategory ?? booking.status;
                return (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => {
                      haptic.light();
                      navigate(`/trips/${booking.trip.id}`);
                    }}
                    className="text-left p-3.5 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] opacity-90 hover:opacity-100 transition"
                  >
                    <div className="flex items-center justify-between text-[12px] text-[var(--tgui--hint_color)] mb-1.5">
                      <span>{dayLabel(booking.trip.date)}</span>
                      <span
                        className={
                          category === "completed"
                            ? "font-semibold text-[var(--app-success)]"
                            : "font-semibold text-[var(--app-danger)]"
                        }
                      >
                        {category === "completed" ? "Поездка завершена" : "Поездка отменена"}
                      </span>
                    </div>
                    <div className="text-[15px] font-semibold text-[var(--tgui--text_color)]">
                      {booking.trip.fromCity} → {booking.trip.toCity}
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[12px] text-[var(--tgui--hint_color)]">
                      <span className="truncate">Водитель: {booking.trip.driver.name}</span>
                      <span className="font-medium shrink-0">
                        {`взнос ~${booking.trip.price * booking.seat} ₽`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </QueryState>
        )}

        {segment === "driver" && (
          <QueryState
            loading={driverTrips.isLoading}
            error={driverTrips.error}
            empty={driverItems.length === 0}
            emptyText="Опубликуйте маршрут, чтобы найти попутчиков и разделить расходы."
            onRetry={() => void driverTrips.refetch()}
          >
            <div className="flex flex-col gap-3">
              {driverItems.map((trip) => {
                const status = tripStatusLabel(trip);
                const finished = trip.status === "cancelled" || trip.status === "completed";
                const pending = trip.pendingRequestsCount ?? 0;
                return (
                  <div
                    key={trip.id}
                    className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--app-info-bg)] text-[var(--app-info)]">
                        Вы водитель
                      </span>
                      <span className="text-[12px] font-medium text-[var(--tgui--hint_color)] truncate">
                        {dayLabel(trip.date)}, {trip.time}
                      </span>
                    </div>

                    <div>
                      <div className="text-[16px] font-bold text-[var(--tgui--text_color)]">
                        {trip.fromCity} → {trip.toCity}
                      </div>
                      <span className="StatusPill" data-tone={status.tone}>
                        {status.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--tgui--tertiary_bg_color)] text-[13px]">
                      <div>
                        <span className="text-[var(--tgui--hint_color)]">Свободно мест: </span>
                        <span className="font-semibold text-[var(--app-success)]">
                          {trip.seatsAvailable} из {trip.seatsTotal}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-[var(--tgui--hint_color)]">
                        Цена:{" "}
                        <span className="font-bold text-[var(--tgui--text_color)]">
                          {trip.price} ₽
                        </span>
                      </div>
                    </div>

                    {pending > 0 && (
                      <div className="p-3 rounded-xl border border-dashed border-[var(--tgui--outline)] bg-[var(--tgui--bg_color)]">
                        <div className="flex items-center justify-between text-xs font-semibold text-[var(--tgui--hint_color)] mb-2">
                          <span>Заявки от попутчиков</span>
                          <span className="text-[var(--app-warning)] font-medium">Новые</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="icon-circle icon-circle--warning shrink-0">
                              <Send size={14} />
                            </span>
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-[var(--tgui--text_color)] truncate">
                                {`Ожидают решения: ${pending}`}
                              </div>
                            </div>
                          </div>
                          <Button
                            size="s"
                            mode="filled"
                            onClick={() => navigate(`/trips/my/${trip.id}/requests`)}
                          >
                            Заявки
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        size="m"
                        mode="bezeled"
                        className="flex-1"
                        onClick={() => {
                          haptic.light();
                          navigate(`/trips/${trip.id}`);
                        }}
                        before={<Car size={15} />}
                      >
                        Управление поездкой
                      </Button>
                      <IconButton
                        size="m"
                        mode="gray"
                        aria-label="Поделиться поездкой"
                        title="Поделиться поездкой"
                        onClick={() => {
                          haptic.light();
                          void shareTrip(trip.id);
                        }}
                      >
                        <Share2 size={16} />
                      </IconButton>
                    </div>

                    {!finished && (
                      <div className="flex gap-2">
                        <ConfirmAction
                          label="Завершить"
                          confirmLabel="Завершить"
                          description="Поездка будет перенесена в архив, а пассажиры смогут оставить отзывы."
                          pending={completeTrip.isPending}
                          onConfirm={() =>
                            completeTrip.mutate(trip.id, {
                              onSuccess: () => {
                                haptic.success();
                                toast.show({ text: "Поездка завершена" });
                              },
                            })
                          }
                        />
                        <ConfirmAction
                          label="Отменить"
                          confirmLabel="Отменить поездку"
                          description="Поездка станет недоступна, а пассажиры получат уведомление."
                          pending={cancelTrip.isPending}
                          onConfirm={() =>
                            cancelTrip.mutate(trip.id, {
                              onSuccess: () => {
                                haptic.warning();
                                toast.show({ text: "Поездка отменена" });
                              },
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {driverTrips.hasNextPage && (
                <>
                  {/* Якорь автодогрузки: скрыт от скринридера, фиксированная
                      высота (min-h-12) держит скролл от прыжков. */}
                  <div
                    ref={driverSentinelRef}
                    aria-hidden="true"
                    className="flex min-h-12 items-center justify-center"
                    style={{ overflowAnchor: "none" }}
                  />
                  {driverTrips.isFetchingNextPage && (
                    <div
                      role="status"
                      aria-label="Загрузка ещё поездок"
                      className="flex flex-col gap-3"
                    >
                      <div className="h-20 animate-pulse rounded-2xl bg-[var(--tgui--secondary_fill)]" />
                      <div className="h-20 animate-pulse rounded-2xl bg-[var(--tgui--secondary_fill)]" />
                    </div>
                  )}
                  <Button
                    stretched
                    mode="bezeled"
                    loading={driverTrips.isFetchingNextPage}
                    disabled={driverTrips.isFetchingNextPage}
                    onClick={() => void driverTrips.fetchNextPage()}
                  >
                    Показать ещё
                  </Button>
                </>
              )}
              <Button size="l" mode="filled" onClick={() => navigate("/trips/my/new")}>
                + Создать ещё поездку
              </Button>
            </div>
          </QueryState>
        )}
      </div>
    </>
  );
}
