import { useEffect, useState } from "react";
import type { AdminBookingDto, BookingStatus } from "@edem/contracts";
import { useSearch } from "@tanstack/react-router";

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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

import { BookingDetailDialog } from "./BookingDetailDialog";
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

function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Начальные значения фильтров из query-строки. Ссылки из карточек поездки и
 * пользователя ведут на `/bookings?tripId=…` / `/bookings?passengerId=…`;
 * читаем их один раз при монтировании, дальше фильтрами управляет форма.
 */
function readInitialFilter(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function BookingsPage() {
  // strict: false — у маршрута нет validateSearch, но ссылки из других
  // экранов передают произвольные фильтры в query-строке.
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const [status, setStatus] = useState<StatusFilterValue>("all");
  const [search, setSearch] = useState("");
  const [passengerId, setPassengerId] = useState(() =>
    readInitialFilter(routeSearch.passengerId),
  );
  const [tripId, setTripId] = useState(() =>
    readInitialFilter(routeSearch.tripId),
  );
  const [page, setPage] = useState(1);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);

  const q = useDebouncedValue(search.trim());
  const passenger = useDebouncedValue(passengerId.trim());
  const trip = useDebouncedValue(tripId.trim());

  const bookingsQuery = useBookingsQuery({
    status: status === "all" ? undefined : status,
    q: q || undefined,
    passengerId: passenger || undefined,
    tripId: trip || undefined,
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

  // Сбрасываем страницу синхронно с изменением любого фильтра: эффект после
  // рендера успевал отправить запрос с новым фильтром и старой страницей.
  const handleFilterChange = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <section className="grid gap-4" aria-labelledby="bookings-page-title">
      <div>
        <h1 className="text-2xl font-semibold" id="bookings-page-title">
          Брони
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Поиск по пассажиру и маршруту, фильтры по поездке и статусу, детали
          брони и смена статуса.
        </p>
      </div>

      <BookingsFilters
        onPassengerIdChange={(value) =>
          handleFilterChange(setPassengerId, value)
        }
        onSearchChange={(value) => handleFilterChange(setSearch, value)}
        onStatusChange={(value) => handleFilterChange(setStatus, value)}
        onTripIdChange={(value) => handleFilterChange(setTripId, value)}
        passengerId={passengerId}
        search={search}
        status={status}
        tripId={tripId}
      />

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
          <BookingsTable
            bookings={bookingsQuery.data.items}
            onDetails={(booking) => setDetailBookingId(booking.id)}
          />
          <Pagination
            page={currentPage}
            total={bookingsQuery.data.total}
            pageSize={bookingsQuery.data.pageSize}
            onPageChange={setPage}
          />
        </>
      )}

      <BookingDetailDialog
        bookingId={detailBookingId}
        onClose={() => setDetailBookingId(null)}
      />
    </section>
  );
}

function BookingsFilters({
  status,
  search,
  passengerId,
  tripId,
  onStatusChange,
  onSearchChange,
  onPassengerIdChange,
  onTripIdChange,
}: {
  status: StatusFilterValue;
  search: string;
  passengerId: string;
  tripId: string;
  onStatusChange: (value: StatusFilterValue) => void;
  onSearchChange: (value: string) => void;
  onPassengerIdChange: (value: string) => void;
  onTripIdChange: (value: string) => void;
}) {
  return (
    <div
      aria-label="Фильтры броней"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      role="group"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="bookings-filter-status">Статус</Label>
        <Select
          value={status}
          onValueChange={(next) => {
            if (!isStatusFilterValue(next)) return;
            onStatusChange(next);
          }}
        >
          <SelectTrigger className="w-full" id="bookings-filter-status">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {ALL_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bookings-filter-q">Пассажир или маршрут</Label>
        <Input
          autoComplete="off"
          id="bookings-filter-q"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Имя, город или адрес"
          value={search}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bookings-filter-passenger">ID пассажира</Label>
        <Input
          autoComplete="off"
          id="bookings-filter-passenger"
          onChange={(event) => onPassengerIdChange(event.target.value)}
          placeholder="Точный ID"
          value={passengerId}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bookings-filter-trip">ID поездки</Label>
        <Input
          autoComplete="off"
          id="bookings-filter-trip"
          onChange={(event) => onTripIdChange(event.target.value)}
          placeholder="Точный ID"
          value={tripId}
        />
      </div>
    </div>
  );
}

function BookingsTable({
  bookings,
  onDetails,
}: {
  bookings: AdminBookingDto[];
  onDetails: (booking: AdminBookingDto) => void;
}) {
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
          <BookingRow
            key={booking.id}
            booking={booking}
            onDetails={onDetails}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function BookingRow({
  booking,
  onDetails,
}: {
  booking: AdminBookingDto;
  onDetails: (booking: AdminBookingDto) => void;
}) {
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDetails(booking)}
          >
            Детали
          </Button>
          <Select
            value={booking.status}
            onValueChange={handleSelectChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger
              aria-label={`Статус брони ${booking.id}`}
              className="w-40"
            >
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
        </div>
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
