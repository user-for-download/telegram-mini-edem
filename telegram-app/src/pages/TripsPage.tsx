import {
  Avatar,
  Button,
  IconButton,
  SegmentedControl,
  Tappable,
} from "@telegram-apps/telegram-ui";
import { FeedCard, FEED_CARD_SURFACE } from "@/components/FeedCard";
import { Calendar, Car, Send, Share2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QueryState } from "@/components/QueryState";
import { TripCardsSkeleton, TripCardSkeleton } from "@/components/Skeletons";
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

type Segment = "active" | "history";

const SEGMENTS: ReadonlyArray<{ value: Segment; label: string }> = [
  { value: "active", label: "Активные" },
  { value: "history", label: "История" },
];

function parseSegment(value: string | null): Segment {
  // Легаси ?segment=driver (старые редиректы) — теперь часть «Активных».
  return value === "history" ? "history" : "active";
}

/** Единый статус истории для пассажира и водителя: завершена / отменена. */
function historyCategoryOf(
  item: { kind: "booking"; booking: PassengerBooking } | { kind: "driving"; trip: Trip },
): "completed" | "cancelled" | "other" {
  if (item.kind === "driving") {
    if (item.trip.status === "completed") return "completed";
    if (item.trip.status === "cancelled") return "cancelled";
    return "other";
  }
  const known = item.booking.historyCategory;
  if (known === "completed" || known === "cancelled") return known;
  if (item.booking.status === "cancelled" || item.booking.status === "declined") {
    return "cancelled";
  }
  return "other";
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
    <div className="flex flex-col gap-2 relative pl-4 border-l-2 border-(--app-info)/30 ml-2 py-0.5">
      <div>
        <div className="text-[15px] font-bold text-(--tgui--text_color)">
          {trip.fromCity}
        </div>
        {trip.fromAddress && (
          <div className="text-[12px] text-(--tgui--hint_color) truncate">
            {trip.fromAddress}
          </div>
        )}
      </div>
      <div className="pt-1">
        <div className="text-[15px] font-bold text-(--tgui--text_color)">
          {trip.toCity}
        </div>
        {trip.toAddress && (
          <div className="text-[12px] text-(--tgui--hint_color) truncate">
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
    <FeedCard className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-(--tgui--hint_color) min-w-0">
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

      <div className="flex items-center justify-between p-2.5 rounded-xl bg-(--tgui--tertiary_bg_color)">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            size={40}
            src={booking.trip.driver.avatar}
            acronym={booking.trip.driver.name.slice(0, 1).toUpperCase()}
          />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-(--tgui--text_color) truncate">
              {booking.trip.driver.name}
            </div>
            <div className="text-[11px] text-(--tgui--hint_color)">
              {`место №${booking.seat}`}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[14px] font-bold text-(--tgui--text_color)">
            {booking.trip.price * booking.seat} ₽
          </div>
          <div className="text-[11px] text-(--tgui--hint_color)">
            {`цена (${booking.seat} ${booking.seat === 1 ? "место" : "места"})`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-(--tgui--outline)">
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
    </FeedCard>
  );
}

/** Карточка поездки водителя: полная (управление, заявки, действия)
 * для «Активных», компактная — для «Истории». */
function DriverTripCard({
  trip,
  archived,
  onRequests,
  onManage,
  onShare,
  onComplete,
  onCancel,
  completePending,
  cancelPending,
}: {
  trip: Trip;
  archived: boolean;
  onRequests: (id: string) => void;
  onManage: (id: string) => void;
  onShare: (id: string) => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  completePending: boolean;
  cancelPending: boolean;
}) {
  const status = tripStatusLabel(trip);
  const pending = trip.pendingRequestsCount ?? 0;

  if (archived) {
    return (
      <Tappable
        Component="button"
        type="button"
        onClick={() => {
          haptic.light();
          onManage(trip.id);
        }}
        className={`${FEED_CARD_SURFACE} text-left p-3.5 opacity-90 hover:opacity-100 transition`}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-(--app-info-bg) text-(--app-info)">
            Вы водитель
          </span>
          <span className="StatusPill shrink-0" data-tone={status.tone}>
            {status.label}
          </span>
        </div>
        <div className="text-[15px] font-semibold text-(--tgui--text_color)">
          {trip.fromCity} → {trip.toCity}
        </div>
        <div className="flex items-center justify-between mt-2 text-[12px] text-(--tgui--hint_color)">
          <span className="truncate">
            {dayLabel(trip.date)}, {trip.time}
          </span>
          <span className="font-medium shrink-0">{trip.price} ₽ / место</span>
        </div>
      </Tappable>
    );
  }

  const finished = trip.status === "cancelled" || trip.status === "completed";
  return (
    <FeedCard className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-(--app-info-bg) text-(--app-info)">
          Вы водитель
        </span>
        <span className="text-[12px] font-medium text-(--tgui--hint_color) truncate">
          {dayLabel(trip.date)}, {trip.time}
        </span>
      </div>

      <div>
        <div className="text-[16px] font-bold text-(--tgui--text_color)">
          {trip.fromCity} → {trip.toCity}
        </div>
        <span className="StatusPill" data-tone={status.tone}>
          {status.label}
        </span>
      </div>

      <div className="flex items-center justify-between p-2.5 rounded-xl bg-(--tgui--tertiary_bg_color) text-[13px]">
        <div>
          <span className="text-(--tgui--hint_color)">Свободно мест: </span>
          <span className="font-semibold text-(--app-success)">
            {trip.seatsAvailable} из {trip.seatsTotal}
          </span>
        </div>
        <div className="text-xs font-medium text-(--tgui--hint_color)">
          Цена:{" "}
          <span className="font-bold text-(--tgui--text_color)">
            {trip.price} ₽
          </span>
        </div>
      </div>

      {pending > 0 && (
        <div className="p-3 rounded-xl border border-dashed border-(--tgui--outline) bg-(--tgui--bg_color)">
          <div className="flex items-center justify-between text-xs font-semibold text-(--tgui--hint_color) mb-2">
            <span>Заявки от попутчиков</span>
            <span className="text-(--app-warning) font-medium">Новые</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="icon-circle icon-circle--warning shrink-0">
                <Send size={14} />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-(--tgui--text_color) truncate">
                  {`Ожидают решения: ${pending}`}
                </div>
              </div>
            </div>
            <Button size="s" mode="filled" onClick={() => onRequests(trip.id)}>
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
            onManage(trip.id);
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
            onShare(trip.id);
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
            pending={completePending}
            onConfirm={() => onComplete(trip.id)}
          />
          <ConfirmAction
            label="Отменить"
            confirmLabel="Отменить поездку"
            description="Поездка станет недоступна, а пассажиры получат уведомление."
            pending={cancelPending}
            onConfirm={() => onCancel(trip.id)}
          />
        </div>
      )}
    </FeedCard>
  );
}

/**
 * «Поездки» — два раздела: «Активные» (брони + поездки за рулём)
 * и «История» (завершённые/отменённые обеих ролей с фильтром по статусу).
 * Сегмент синхронизирован с ?segment= (?segment=driver — легаси, ведёт
 * в «Активные»; deep-links/редиректы со старых маршрутов).
 */
export function TripsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const segment = parseSegment(searchParams.get("segment"));

  const bookings = useMyBookingsQuery({ enabled: segment === "active" });
  const history = usePassengerHistoryQuery({ enabled: segment === "history" });
  const driverActive = useInfiniteMyTripsQuery({
    status: "active",
    enabled: segment === "active",
  });
  const driverArchive = useInfiniteMyTripsQuery({
    status: "archive",
    enabled: segment === "history",
  });
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

  const activeDriverTrips =
    driverActive.data?.pages.flatMap((page) => page.items) ?? [];

  type HistoryItem =
    | { kind: "booking"; key: string; at: number; booking: PassengerBooking }
    | { kind: "driving"; key: string; at: number; trip: Trip };

  const tripTime = (trip: { departureAt?: string; date: string; time: string }): number => {
    if (trip.departureAt) {
      const parsed = Date.parse(trip.departureAt);
      if (!Number.isNaN(parsed)) return parsed;
    }
    const fallback = Date.parse(`${trip.date}T${trip.time}`);
    return Number.isNaN(fallback) ? 0 : fallback;
  };

  const historyItems: HistoryItem[] = [    ...(history.data ?? []).map((booking) => ({
      kind: "booking" as const,
      key: `b-${booking.id}`,
      at: tripTime(booking.trip),
      booking,
    })),
    ...(driverArchive.data?.pages.flatMap((page) => page.items) ?? []).map((trip) => ({
      kind: "driving" as const,
      key: `d-${trip.id}`,
      at: tripTime(trip),
      trip,
    })),
  ]
    .sort((a, b) => b.at - a.at);

  // Сентинелы автодогрузки водительских поездок (контракт
  // useInfiniteMyTripsQuery не меняется; SSR — тихий фолбэк).
  const activeSentinelRef = useInfiniteSentinel({
    hasNextPage: driverActive.hasNextPage,
    isFetchingNextPage: driverActive.isFetchingNextPage,
    fetchNextPage: () => {
      void driverActive.fetchNextPage();
    },
    disabled: segment !== "active",
  });
  const archiveSentinelRef = useInfiniteSentinel({
    hasNextPage: driverArchive.hasNextPage,
    isFetchingNextPage: driverArchive.isFetchingNextPage,
    fetchNextPage: () => {
      void driverArchive.fetchNextPage();
    },
    disabled: segment !== "history",
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
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
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
            loading={bookings.isLoading || driverActive.isLoading}
            error={bookings.error ?? driverActive.error}
            empty={activeBookings.length === 0 && activeDriverTrips.length === 0}
            emptyText="Пока тихо: забронируйте поездку или опубликуйте свой маршрут!"
            skeleton={<TripCardsSkeleton />}
            onRetry={() => {
              void bookings.refetch();
              void driverActive.refetch();
            }}
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
              {activeDriverTrips.map((trip) => (
                <DriverTripCard
                  key={trip.id}
                  trip={trip}
                  archived={false}
                  onRequests={(id) => navigate(`/trips/my/${id}/requests`)}
                  onManage={(id) => {
                    haptic.light();
                    navigate(`/trips/${id}`);
                  }}
                  onShare={(id) => {
                    haptic.light();
                    void shareTrip(id);
                  }}
                  onComplete={(id) =>
                    completeTrip.mutate(id, {
                      onSuccess: () => {
                        haptic.success();
                        toast.show({ text: "Поездка завершена" });
                      },
                    })
                  }
                  onCancel={(id) =>
                    cancelTrip.mutate(id, {
                      onSuccess: () => {
                        haptic.warning();
                        toast.show({ text: "Поездка отменена" });
                      },
                    })
                  }
                  completePending={completeTrip.isPending}
                  cancelPending={cancelTrip.isPending}
                />
              ))}
              {driverActive.hasNextPage && (
                <>
                  <div
                    ref={activeSentinelRef}
                    aria-hidden="true"
                    className="flex min-h-12 items-center justify-center"
                    style={{ overflowAnchor: "none" }}
                  />
                  {driverActive.isFetchingNextPage && (
                    <div
                      role="status"
                      aria-label="Загрузка ещё поездок"
                      className="flex flex-col gap-3"
                    >
                      <TripCardSkeleton />
                    </div>
                  )}
                  <Button
                    stretched
                    mode="bezeled"
                    loading={driverActive.isFetchingNextPage}
                    disabled={driverActive.isFetchingNextPage}
                    onClick={() => void driverActive.fetchNextPage()}
                  >
                    Показать ещё
                  </Button>
                </>
              )}
              <Button size="l" mode="filled" onClick={() => navigate("/trips")}>
                Найти поездку
              </Button>
              <Button size="l" mode="bezeled" onClick={() => navigate("/trips/my/new")}>
                + Создать поездку
              </Button>
            </div>
          </QueryState>
        )}

        {segment === "history" && (
          <QueryState
            loading={history.isLoading || driverArchive.isLoading}
            error={history.error ?? driverArchive.error}
            empty={historyItems.length === 0}
            emptyText="Здесь появятся завершённые и отменённые поездки."
            skeleton={<TripCardsSkeleton />}
            onRetry={() => {
              void history.refetch();
              void driverArchive.refetch();
            }}
          >
            <div className="flex flex-col gap-3 mt-1">
              {historyItems.map((item) => {
                if (item.kind === "driving") {
                  return (
                    <DriverTripCard
                      key={item.key}
                      trip={item.trip}
                      archived
                      onRequests={() => {}}
                      onManage={(id) => {
                        haptic.light();
                        navigate(`/trips/${id}`);
                      }}
                      onShare={() => {}}
                      onComplete={() => {}}
                      onCancel={() => {}}
                      completePending={false}
                      cancelPending={false}
                    />
                  );
                }
                const booking = item.booking;
                const category = historyCategoryOf(item);
                return (
                  <Tappable
                    Component="button"
                    key={item.key}
                    type="button"
                    onClick={() => {
                      haptic.light();
                      navigate(`/trips/${booking.trip.id}`);
                    }}
                    className={`${FEED_CARD_SURFACE} text-left p-3.5 opacity-90 hover:opacity-100 transition`}
                  >
                    <div className="flex items-center justify-between text-[12px] text-(--tgui--hint_color) mb-1.5">
                      <span>{dayLabel(booking.trip.date)}</span>
                      <span
                        className={
                          category === "completed"
                            ? "font-semibold text-(--app-success)"
                            : "font-semibold text-(--app-danger)"
                        }
                      >
                        {category === "completed" ? "Поездка завершена" : "Поездка отменена"}
                      </span>
                    </div>
                    <div className="text-[15px] font-semibold text-(--tgui--text_color)">
                      {booking.trip.fromCity} → {booking.trip.toCity}
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[12px] text-(--tgui--hint_color)">
                      <span className="truncate">Водитель: {booking.trip.driver.name}</span>
                      <span className="font-medium shrink-0">
                        {`взнос ~${booking.trip.price * booking.seat} ₽`}
                      </span>
                    </div>
                  </Tappable>
                );
              })}
              {driverArchive.hasNextPage && (
                <>
                  <div
                    ref={archiveSentinelRef}
                    aria-hidden="true"
                    className="flex min-h-12 items-center justify-center"
                    style={{ overflowAnchor: "none" }}
                  />
                  {driverArchive.isFetchingNextPage && (
                    <div
                      role="status"
                      aria-label="Загрузка ещё поездок"
                      className="flex flex-col gap-3"
                    >
                      <TripCardSkeleton />
                    </div>
                  )}
                  <Button
                    stretched
                    mode="bezeled"
                    loading={driverArchive.isFetchingNextPage}
                    disabled={driverArchive.isFetchingNextPage}
                    onClick={() => void driverArchive.fetchNextPage()}
                  >
                    Показать ещё
                  </Button>
                </>
              )}
            </div>
          </QueryState>
        )}

      </div>
    </>
  );
}
