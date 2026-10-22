import type {
  AdminTripBookingSummaryDto,
  AdminTripDetailDto,
} from "@edem/contracts";
import { AlertCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

import { useTripDetailQuery } from "./queries";

const TRIP_STATUS_LABELS: Record<string, string> = {
  active: "Активная",
  cancelled: "Отменена",
  completed: "Завершена",
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает",
  confirmed: "Подтверждена",
  declined: "Отклонена",
  cancelled: "Отменена",
};

const BOOKING_ROW_CLASSES =
  "block rounded-md border p-2 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Карточка поездки: маршрут, адреса, отправление, цена, места, водитель и
 * ограниченный бэкендом список броней с пассажирами. Каждая бронь ведёт в
 * список броней с фильтром по этой поездке.
 */
export function TripDetailDialog({
  tripId,
  onClose,
}: {
  tripId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useTripDetailQuery(tripId);

  return (
    <Dialog
      open={tripId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {detailQuery.data
              ? `${detailQuery.data.fromCity} → ${detailQuery.data.toCity}`
              : "Карточка поездки"}
          </DialogTitle>
          <DialogDescription>
            {detailQuery.data
              ? `ID: ${detailQuery.data.id}`
              : "Маршрут, брони и пассажиры"}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isPending && <TripDetailLoading />}

        {detailQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Не удалось загрузить поездку</AlertTitle>
            <AlertDescription>
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Неизвестная ошибка"}
            </AlertDescription>
            <AlertAction>
              <Button
                onClick={() => void detailQuery.refetch()}
                size="sm"
                type="button"
                variant="outline"
              >
                Повторить
              </Button>
            </AlertAction>
          </Alert>
        )}

        {!detailQuery.isPending &&
          !detailQuery.isError &&
          !detailQuery.data && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Поездка не найдена
            </p>
          )}

        {detailQuery.data && <TripDetailContent trip={detailQuery.data} />}
      </DialogContent>
    </Dialog>
  );
}

function TripDetailContent({ trip }: { trip: AdminTripDetailDto }) {
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <TripStatusBadge status={trip.status} />
        <Badge variant="outline">
          {trip.seatsAvailable}/{trip.seatsTotal} мест свободно
        </Badge>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <DetailItem label="Маршрут" value={`${trip.fromCity} → ${trip.toCity}`} />
        <DetailItem label="Отправление" value={formatDateTime(trip.departureAt)} />
        <DetailItem label="Откуда" value={trip.fromAddress} />
        <DetailItem label="Куда" value={trip.toAddress} />
        <DetailItem label="Цена" value={`${trip.price} ₽`} />
        <DetailItem
          label="Места"
          value={`${trip.seatsAvailable} свободно из ${trip.seatsTotal}`}
        />
        <DetailItem label="Водитель" value={trip.driverName} />
        <DetailItem label="Создана" value={formatDateTime(trip.createdAt)} />
      </dl>

      <section className="grid gap-2" aria-labelledby="trip-bookings-title">
        <h3 className="text-sm font-medium" id="trip-bookings-title">
          Брони ({trip.bookings.length})
        </h3>
        {trip.bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Броней нет</p>
        ) : (
          <div className="grid gap-2">
            {trip.bookings.map((booking) => (
              <TripBookingRow booking={booking} key={booking.id} tripId={trip.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-3 border-b border-border/60 py-1">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right">{value}</dd>
    </div>
  );
}

function TripBookingRow({
  booking,
  tripId,
}: {
  booking: AdminTripBookingSummaryDto;
  tripId: string;
}) {
  return (
    <Link
      className={BOOKING_ROW_CLASSES}
      search={{ tripId }}
      to="/bookings"
    >
      <span className="font-medium">{booking.passengerName}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        Место {booking.seat} ·{" "}
        {BOOKING_STATUS_LABELS[booking.status] ?? booking.status} ·{" "}
        {formatDateTime(booking.createdAt)}
      </span>
    </Link>
  );
}

function TripStatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return <Badge variant="secondary">{TRIP_STATUS_LABELS.active}</Badge>;
  }
  if (status === "cancelled") {
    return <Badge variant="destructive">{TRIP_STATUS_LABELS.cancelled}</Badge>;
  }
  if (status === "completed") {
    return <Badge variant="default">{TRIP_STATUS_LABELS.completed}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function TripDetailLoading() {
  return (
    <div
      aria-label="Загрузка карточки поездки"
      className="grid gap-3"
      role="status"
    >
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
