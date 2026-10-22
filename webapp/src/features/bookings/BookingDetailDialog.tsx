import type { AdminBookingDetailDto } from "@edem/contracts";
import { Link } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";

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

import { useBookingDetailQuery } from "./queries";

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает",
  confirmed: "Подтверждена",
  declined: "Отклонена",
  cancelled: "Отменена",
};

const TRIP_STATUS_LABELS: Record<string, string> = {
  active: "Активная",
  cancelled: "Отменена",
  completed: "Завершена",
};

/**
 * Read-only карточка брони из GET /admin/bookings/:id: контекст поездки
 * (маршрут, отправление, статус, водитель) и пассажира (имя, рейтинг,
 * телефон, аватар). Смена статуса остаётся в списке — диалог не держит
 * второй экземпляр мутации с собственным состоянием.
 */
export function BookingDetailDialog({
  bookingId,
  onClose,
}: {
  bookingId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useBookingDetailQuery(bookingId);

  return (
    <Dialog
      open={bookingId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {detailQuery.data ? detailQuery.data.tripRoute : "Карточка брони"}
          </DialogTitle>
          <DialogDescription>
            {detailQuery.data
              ? `ID: ${detailQuery.data.id} · создана ${formatDateTime(
                  detailQuery.data.createdAt,
                )}`
              : "Поездка, пассажир и статус брони"}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isPending && <BookingDetailLoading />}

        {detailQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Не удалось загрузить бронь</AlertTitle>
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
              Бронь не найдена
            </p>
          )}

        {detailQuery.data && (
          <BookingDetailContent booking={detailQuery.data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BookingDetailContent({ booking }: { booking: AdminBookingDetailDto }) {
  const bookingStatusLabel =
    BOOKING_STATUS_LABELS[booking.status] ?? booking.status;
  const tripStatusLabel =
    TRIP_STATUS_LABELS[booking.tripStatus] ?? booking.tripStatus;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <BookingStatusBadge status={booking.status} />
        <Badge variant="outline">Место {booking.seat}</Badge>
        <TripStatusBadge status={booking.tripStatus} />
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <DetailItem label="Маршрут" value={booking.tripRoute} />
        <DetailItem
          label="Отправление"
          value={formatDateTime(booking.departureAt)}
        />
        <DetailItem label="Статус поездки" value={tripStatusLabel} />
        <DetailItem label="Водитель" value={booking.driverName} />
        <DetailItem label="Статус брони" value={bookingStatusLabel} />
        <DetailItem label="Место" value={String(booking.seat)} />
        <DetailItem label="Создана" value={formatDateTime(booking.createdAt)} />
        <DetailItem label="ID брони" value={booking.id} />
      </dl>

      <section className="grid gap-2" aria-labelledby="booking-passenger-title">
        <h3 className="text-sm font-medium" id="booking-passenger-title">
          Пассажир
        </h3>
        <div className="flex items-center gap-3 rounded-md border p-3">
          <img
            alt=""
            className="size-12 shrink-0 rounded-full object-cover"
            src={booking.passengerAvatar}
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{booking.passengerName}</p>
            <p className="text-xs text-muted-foreground">
              Рейтинг {booking.passengerRating.toFixed(1)} ·{" "}
              {booking.passengerPhone ?? "Телефон не указан"}
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link search={{ driverId: booking.driverId }} to="/trips">
            Поездки водителя
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link search={{ id: booking.passengerId }} to="/users">
            Карточка пассажира
          </Link>
        </Button>
      </div>
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

function BookingStatusBadge({ status }: { status: string }) {
  const label = BOOKING_STATUS_LABELS[status] ?? status;
  if (status === "pending") {
    return <Badge variant="secondary">{label}</Badge>;
  }
  if (status === "confirmed") {
    return (
      <Badge className="bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400">
        {label}
      </Badge>
    );
  }
  if (status === "declined") {
    return <Badge variant="destructive">{label}</Badge>;
  }
  return <Badge variant="outline">{label}</Badge>;
}

function TripStatusBadge({ status }: { status: string }) {
  const label = TRIP_STATUS_LABELS[status] ?? status;
  if (status === "active") {
    return <Badge variant="secondary">{label}</Badge>;
  }
  if (status === "cancelled") {
    return <Badge variant="destructive">{label}</Badge>;
  }
  return <Badge variant="outline">{label}</Badge>;
}

function BookingDetailLoading() {
  return (
    <div
      aria-label="Загрузка карточки брони"
      className="grid gap-3"
      role="status"
    >
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
