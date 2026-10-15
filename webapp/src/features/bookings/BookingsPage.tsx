import { useState } from "react";
import type { AdminBookingDto, BookingStatus } from "@edem/contracts";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { countPages } from "@/lib/page-clamp";
import { useClampedPageIndex } from "@/lib/use-clamped-page";

import { useBookingStatusMutation, useBookingsQuery } from "./queries";

const PAGE_SIZE = 20;

const ALL_STATUSES: BookingStatus[] = [
  "pending",
  "confirmed",
  "declined",
  "cancelled",
];

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Ожидает",
  confirmed: "Подтверждена",
  declined: "Отклонена",
  cancelled: "Отменена",
};

type StatusFilterValue = BookingStatus | "all";

/**
 * Radix Select возвращает строку — проверяем её рантайм-гвардом, а не
 * слепым cast (audit: unchecked cast на границе компонента). Неизвестное
 * значение игнорируется: фильтр не переводится в невалидный статус.
 */
function isBookingStatus(value: string): value is BookingStatus {
  return (ALL_STATUSES as readonly string[]).includes(value);
}

function isStatusFilterValue(value: string): value is StatusFilterValue {
  return value === "all" || isBookingStatus(value);
}

export function BookingsPage() {
  const [status, setStatus] = useState<StatusFilterValue>("all");
  const [page, setPage] = useState(1);
  const bookingsQuery = useBookingsQuery({
    status: status === "all" ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });

  // Смена статуса брони на последней странице сжимает выборку — индекс
  // страницы прижимается, иначе таблица пустеет (audit F8).
  const currentPage = useClampedPageIndex(
    page,
    bookingsQuery.data
      ? countPages(bookingsQuery.data.total, bookingsQuery.data.pageSize)
      : undefined,
    setPage,
  );

  const handleFilterChange = (next: StatusFilterValue) => {
    setStatus(next);
    setPage(1);
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Брони</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Список броней с фильтром по статусу и сменой статуса.
          </p>
        </div>
        <StatusFilter value={status} onChange={handleFilterChange} />
      </div>

      {bookingsQuery.isPending && <BookingsSkeleton />}
      {bookingsQuery.isError && (
        <BookingsError
          message={
            bookingsQuery.error instanceof Error
              ? bookingsQuery.error.message
              : "Неизвестная ошибка"
          }
          onRetry={() => void bookingsQuery.refetch()}
        />
      )}
      {bookingsQuery.data && (
        <>
          <BookingsTable bookings={bookingsQuery.data.items} />
          <Pagination
            page={currentPage}
            total={bookingsQuery.data.total}
            pageSize={bookingsQuery.data.pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}

function StatusFilter({
  value,
  onChange,
}: {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (!isStatusFilterValue(next)) return;
        onChange(next);
      }}
    >
      <SelectTrigger aria-label="Фильтр по статусу" className="w-44">
        <SelectValue placeholder="Все" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все</SelectItem>
        {ALL_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {STATUS_LABELS[status]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BookingsTable({ bookings }: { bookings: AdminBookingDto[] }) {
  if (bookings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Брони не найдены.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Поездка</TableHead>
          <TableHead>Пассажир</TableHead>
          <TableHead>Место</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Создана</TableHead>
          <TableHead>Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((booking) => (
          <BookingRow key={booking.id} booking={booking} />
        ))}
      </TableBody>
    </Table>
  );
}

function BookingRow({ booking }: { booking: AdminBookingDto }) {
  const mutation = useBookingStatusMutation();
  // Pending status awaiting explicit confirmation — no one-click status change.
  const [pendingStatus, setPendingStatus] = useState<BookingStatus | null>(
    null,
  );
  // Guarded lookup: `booking.status` is a plain string in the DTO, so an
  // unchecked cast could render `undefined` for an unexpected value.
  const currentLabel = isBookingStatus(booking.status)
    ? STATUS_LABELS[booking.status]
    : booking.status;

  const handleSelectChange = (value: string) => {
    if (!isBookingStatus(value)) return;
    if (value === booking.status) return;
    setPendingStatus(value);
  };

  const handleCancel = () => {
    setPendingStatus(null);
  };

  const handleConfirm = () => {
    if (pendingStatus === null) return;
    const next = pendingStatus;
    setPendingStatus(null);
    mutation.mutate({ id: booking.id, body: { status: next } });
  };

  return (
    <TableRow>
      <TableCell>{booking.tripRoute}</TableCell>
      <TableCell>{booking.passengerName}</TableCell>
      <TableCell>{booking.seat}</TableCell>
      <TableCell>
        <StatusBadge status={booking.status} />
      </TableCell>
      <TableCell>{formatDateTime(booking.createdAt)}</TableCell>
      <TableCell>
        <Select
          value={booking.status}
          onValueChange={handleSelectChange}
          disabled={mutation.isPending}
        >
          <SelectTrigger aria-label={`Статус брони ${booking.id}`} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog
          open={pendingStatus !== null}
          onOpenChange={(open) => {
            if (!open) handleCancel();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Сменить статус брони?</DialogTitle>
              <DialogDescription>
                Бронь {booking.tripRoute} ({booking.passengerName}):{" "}
                {currentLabel}
                {pendingStatus !== null && (
                  <> → {STATUS_LABELS[pendingStatus]}</>
                )}
                .
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleCancel} type="button" variant="outline">
                Отмена
              </Button>
              <Button
                onClick={handleConfirm}
                type="button"
                disabled={mutation.isPending}
              >
                Подтвердить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") {
    return <Badge variant="secondary">{STATUS_LABELS.pending}</Badge>;
  }
  if (status === "confirmed") {
    return (
      <Badge className="bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400">
        {STATUS_LABELS.confirmed}
      </Badge>
    );
  }
  if (status === "declined") {
    return <Badge variant="destructive">{STATUS_LABELS.declined}</Badge>;
  }
  if (status === "cancelled") {
    return <Badge variant="outline">{STATUS_LABELS.cancelled}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = countPages(total, pageSize);
  const hasNext = page < totalPages;
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Страница {page} · всего броней: {total}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Назад
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onClick={() => onPageChange(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </div>
  );
}

function BookingsSkeleton() {
  return (
    <div aria-label="Загрузка броней" className="grid gap-3 py-2" role="status">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function BookingsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Не удалось загрузить брони</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Повторить
        </Button>
      </AlertAction>
    </Alert>
  );
}
