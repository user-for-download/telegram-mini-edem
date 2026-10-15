import { useState } from "react";
import { AlertCircle } from "lucide-react";
import type { AdminPaginatedTrips, AdminTripDto } from "@edem/contracts";

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
  DialogClose,
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

import type { TripStatus } from "./api";
import { useCancelTripMutation, useTripsQuery } from "./queries";

const PAGE_SIZE = 10;

type StatusFilterValue = "" | TripStatus;

const TRIP_STATUSES: TripStatus[] = ["active", "cancelled", "completed"];

// Локализованные статусы поездок (audit: сырые английские идентификаторы
// в фильтре и бейджах при русской остальной панели).
const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  active: "Активная",
  cancelled: "Отменена",
  completed: "Завершена",
};

/**
 * Radix Select возвращает строку — рантайм-гвард вместо cast
 * (audit: unchecked cast на границе компонента).
 */
function isTripStatus(value: string): value is TripStatus {
  return (TRIP_STATUSES as readonly string[]).includes(value);
}

export function TripsPage() {
  const [status, setStatus] = useState<StatusFilterValue>("");
  const [page, setPage] = useState(1);
  const [tripToCancel, setTripToCancel] = useState<AdminTripDto | null>(null);
  const tripsQuery = useTripsQuery({
    status: status || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const cancelMutation = useCancelTripMutation();

  // Список поездок может сжаться (фильтр/отмена) — индекс страницы обязан
  // остаться валидным, иначе таблица пустеет при непустых данных (audit F8).
  const currentPage = useClampedPageIndex(
    page,
    tripsQuery.data ? countPages(tripsQuery.data.total, tripsQuery.data.pageSize) : undefined,
    setPage,
  );

  const handleStatusChange = (next: StatusFilterValue) => {
    setStatus(next);
    setPage(1);
  };

  const confirmCancel = () => {
    if (!tripToCancel) return;
    cancelMutation.mutate(tripToCancel.id, {
      onSuccess: () => setTripToCancel(null),
    });
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Поездки</h1>
        <StatusFilter value={status} onChange={handleStatusChange} />
      </div>
      {tripsQuery.isPending && <TripsLoading />}
      {tripsQuery.isError && (
        <TripsError
          message={tripsQuery.error?.message ?? "Неизвестная ошибка"}
          onRetry={() => void tripsQuery.refetch()}
        />
      )}
      {tripsQuery.data && (
        <>
          <TripsTable trips={tripsQuery.data.items} onCancel={setTripToCancel} />
          <TripsPagination data={tripsQuery.data} page={currentPage} onPageChange={setPage} />
        </>
      )}
      <CancelTripDialog
        trip={tripToCancel}
        isPending={cancelMutation.isPending}
        onClose={() => setTripToCancel(null)}
        onConfirm={confirmCancel}
      />
    </section>
  );
}

const STATUS_OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: "", label: "Все" },
  { value: "active", label: TRIP_STATUS_LABELS.active },
  { value: "cancelled", label: TRIP_STATUS_LABELS.cancelled },
  { value: "completed", label: TRIP_STATUS_LABELS.completed },
];

function StatusFilter({
  value,
  onChange,
}: {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
}) {
  return (
    <Select
      value={value || "all"}
      onValueChange={(next) => {
        if (next !== "all" && !isTripStatus(next)) return;
        onChange(next === "all" ? "" : next);
      }}
    >
      <SelectTrigger aria-label="Фильтр по статусу" className="w-44">
        <SelectValue placeholder="Статус" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((option) => (
          <SelectItem key={option.label} value={option.value || "all"}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TripsTable({
  trips,
  onCancel,
}: {
  trips: AdminTripDto[];
  onCancel: (trip: AdminTripDto) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Водитель</TableHead>
          <TableHead>Маршрут</TableHead>
          <TableHead>Цена</TableHead>
          <TableHead>Места</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Отправление</TableHead>
          <TableHead>Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trips.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={7}
              className="h-24 text-center text-muted-foreground"
            >
              Поездки не найдены
            </TableCell>
          </TableRow>
        ) : (
          trips.map((trip) => (
            <TripRow key={trip.id} trip={trip} onCancel={onCancel} />
          ))
        )}
      </TableBody>
    </Table>
  );
}

function TripRow({
  trip,
  onCancel,
}: {
  trip: AdminTripDto;
  onCancel: (trip: AdminTripDto) => void;
}) {
  return (
    <TableRow>
      <TableCell>{trip.driverName}</TableCell>
      <TableCell>
        {trip.fromCity} → {trip.toCity}
      </TableCell>
      <TableCell>{trip.price} ₽</TableCell>
      <TableCell>
        {trip.seatsAvailable}/{trip.seatsTotal}
      </TableCell>
      <TableCell>
        <TripStatusBadge status={trip.status} />
      </TableCell>
      <TableCell>{formatDateTime(trip.departureAt)}</TableCell>
      <TableCell>
        <Button
          variant="destructive"
          size="sm"
          disabled={trip.status !== "active"}
          onClick={() => onCancel(trip)}
        >
          Отменить
        </Button>
      </TableCell>
    </TableRow>
  );
}

function TripStatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/15 text-green-700 dark:text-green-400"
      >
        {TRIP_STATUS_LABELS.active}
      </Badge>
    );
  }
  if (status === "cancelled") {
    return <Badge variant="destructive">{TRIP_STATUS_LABELS.cancelled}</Badge>;
  }
  return <Badge variant="default">{TRIP_STATUS_LABELS.completed}</Badge>;
}

function TripsPagination({
  data,
  page,
  onPageChange,
}: {
  data: AdminPaginatedTrips;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = countPages(data.total, data.pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">
        Страница {page} из {totalPages} · всего поездок: {data.total}
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
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </div>
  );
}

function CancelTripDialog({
  trip,
  isPending,
  onClose,
  onConfirm,
}: {
  trip: AdminTripDto | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={trip !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отменить поездку?</DialogTitle>
          <DialogDescription>
            {trip
              ? `Поездка ${trip.fromCity} → ${trip.toCity} на ${formatDateTime(
                  trip.departureAt
                )} будет отменена. Это действие нельзя отменить.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Не отменять
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Отмена…" : "Отменить поездку"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TripsLoading() {
  return (
    <div className="grid gap-3" role="status" aria-label="Загрузка поездок">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function TripsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Не удалось загрузить поездки</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      </AlertAction>
    </Alert>
  );
}
