import { useState, type ReactNode } from "react";

import type {
  AdminBookingDto,
  AdminFeedbackDto,
  AdminTripDto,
  AdminUserDetailDto,
  AdminUserReportSummaryDto,
} from "@edem/contracts";
import { Link } from "@tanstack/react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
} from "../reports/labels";
import { useStopTelegramMutation, useUserDetailQuery } from "./queries";

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

const ROW_LINK_CLASSES =
  "block rounded-md border p-2 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Карточка пользователя в диалоге: базовые данные, состояние Telegram/согласия,
 * ограниченные списки связанных сущностей и ручной стоп Telegram.
 *
 * Диалог подтверждения — отдельный соседний Dialog, а не вложенный в контент
 * карточки: так два focus-trap не оказываются друг внутри друга.
 */
export function UserDetailDrawer({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useUserDetailQuery(userId);
  const stopMutation = useStopTelegramMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const open = userId !== null;

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    setConfirmOpen(false);
    onClose();
  };

  const handleConfirmStop = () => {
    if (!detailQuery.data) return;
    stopMutation.mutate(detailQuery.data.id, {
      onSuccess: () => setConfirmOpen(false),
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {detailQuery.data?.name ?? "Карточка пользователя"}
            </DialogTitle>
            <DialogDescription>
              {detailQuery.data
                ? `ID: ${detailQuery.data.id}`
                : "Данные пользователя и последняя активность"}
            </DialogDescription>
          </DialogHeader>

          {detailQuery.isPending && (
            <div
              aria-label="Загрузка карточки пользователя"
              className="grid gap-3"
              role="status"
            >
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {detailQuery.isError && (
            <Alert variant="destructive">
              <AlertTitle>Не удалось загрузить пользователя</AlertTitle>
              <AlertDescription>
                {detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : "Неизвестная ошибка"}
              </AlertDescription>
              <div className="col-span-full mt-2">
                <Button
                  onClick={() => void detailQuery.refetch()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Повторить
                </Button>
              </div>
            </Alert>
          )}

          {!detailQuery.isPending && !detailQuery.isError && !detailQuery.data && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Пользователь не найден
            </p>
          )}

          {detailQuery.data && (
            <UserDetailContent
              onStopTelegram={() => setConfirmOpen(true)}
              user={detailQuery.data}
            />
          )}
        </DialogContent>
      </Dialog>

      <StopTelegramConfirmDialog
        isPending={stopMutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmStop}
        open={confirmOpen}
        user={detailQuery.data ?? null}
      />
    </>
  );
}

function UserDetailContent({
  user,
  onStopTelegram,
}: {
  user: AdminUserDetailDto;
  onStopTelegram: () => void;
}) {
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <img
          alt=""
          className="size-12 shrink-0 rounded-full object-cover"
          src={user.avatar}
        />
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">
            На платформе с {formatDateTime(user.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.bannedAt ? (
            <Badge variant="destructive">Заблокирован</Badge>
          ) : (
            <Badge variant="secondary">Активен</Badge>
          )}
          {user.isVerified && <Badge variant="outline">Проверен</Badge>}
          <Badge variant={user.telegramConnected ? "secondary" : "outline"}>
            Telegram: {user.telegramConnected ? "подключён" : "нет"}
          </Badge>
        </div>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <DetailItem label="Телефон" value={user.phone ?? "—"} />
        <DetailItem
          label="Telegram ID"
          value={user.telegramUserId ?? "—"}
        />
        <DetailItem
          label="Чат с ботом"
          value={
            user.tgChatJoinedAt
              ? formatDateTime(user.tgChatJoinedAt)
              : "Не подключён"
          }
        />
        <DetailItem
          label="Согласие (152-ФЗ)"
          value={
            user.consentAcceptedAt
              ? formatDateTime(user.consentAcceptedAt)
              : "Не получено"
          }
        />
        <DetailItem label="Рейтинг" value={user.rating.toFixed(1)} />
        <DetailItem label="Поездок" value={String(user.tripsCount)} />
        <DetailItem label="Отзывов" value={String(user.reviewsCount)} />
        <DetailItem
          label="Бан"
          value={
            user.bannedAt
              ? `${formatDateTime(user.bannedAt)}${user.banReason ? ` · ${user.banReason}` : ""}`
              : "Нет"
          }
        />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Telegram-уведомления</p>
          <p className="text-xs text-muted-foreground">
            Стоп снимает согласие и отменяет незавершённые доставки.
          </p>
        </div>
        <Button
          onClick={onStopTelegram}
          type="button"
          variant="destructive"
        >
          Остановить Telegram
        </Button>
      </div>

      <RecentSection
        empty="Поездок нет"
        title={`Последние поездки (${user.recentTrips.length})`}
      >
        {user.recentTrips.map((trip) => (
          <TripRow key={trip.id} trip={trip} userId={user.id} />
        ))}
      </RecentSection>

      <RecentSection
        empty="Броней нет"
        title={`Последние брони (${user.recentBookings.length})`}
      >
        {user.recentBookings.map((booking) => (
          <BookingRow
            booking={booking}
            key={booking.id}
            userId={user.id}
          />
        ))}
      </RecentSection>

      <RecentSection
        empty="Жалоб нет"
        title={`Последние жалобы (${user.recentReports.length})`}
      >
        {user.recentReports.map((report) => (
          <ReportRow key={report.id} report={report} />
        ))}
      </RecentSection>

      <RecentSection
        empty="Обращений нет"
        title={`Последние обращения (${user.recentFeedback.length})`}
      >
        {user.recentFeedback.map((feedback) => (
          <FeedbackRow feedback={feedback} key={feedback.id} />
        ))}
      </RecentSection>
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

function RecentSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {hasChildren ? (
        <div className="grid gap-2">{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function TripRow({ trip, userId }: { trip: AdminTripDto; userId: string }) {
  return (
    <Link
      className={ROW_LINK_CLASSES}
      search={{ driverId: userId }}
      to="/trips"
    >
      <span className="font-medium">
        {trip.fromCity} → {trip.toCity}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {formatDateTime(trip.departureAt)} ·{" "}
        {TRIP_STATUS_LABELS[trip.status] ?? trip.status}
      </span>
    </Link>
  );
}

function BookingRow({
  booking,
  userId,
}: {
  booking: AdminBookingDto;
  userId: string;
}) {
  return (
    <Link
      className={ROW_LINK_CLASSES}
      search={{ passengerId: userId }}
      to="/bookings"
    >
      <span className="font-medium">{booking.tripRoute}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        Место {booking.seat} · {formatDateTime(booking.createdAt)} ·{" "}
        {BOOKING_STATUS_LABELS[booking.status] ?? booking.status}
      </span>
    </Link>
  );
}

function ReportRow({ report }: { report: AdminUserReportSummaryDto }) {
  return (
    <Link className={ROW_LINK_CLASSES} to="/reports">
      <span className="font-medium">
        {REPORT_TARGET_TYPE_LABELS[report.targetType]} ·{" "}
        {REPORT_CATEGORY_LABELS[report.category]}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {REPORT_STATUS_LABELS[report.status]} ·{" "}
        {formatDateTime(report.createdAt)}
      </span>
    </Link>
  );
}

function FeedbackRow({ feedback }: { feedback: AdminFeedbackDto }) {
  return (
    <Link
      className={ROW_LINK_CLASSES}
      search={{ answered: "false" }}
      to="/feedback"
    >
      <span className="font-medium">{feedback.subject}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {feedback.reply ? "Отвечено" : "Ожидает ответа"} ·{" "}
        {formatDateTime(feedback.createdAt)}
      </span>
    </Link>
  );
}

function StopTelegramConfirmDialog({
  open,
  user,
  isPending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  user: AdminUserDetailDto | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open && user !== null}
      onOpenChange={(next) => {
        if (!next && !isPending) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Остановить Telegram-уведомления?</DialogTitle>
          <DialogDescription>
            {user
              ? `${user.name} больше не будет получать сообщения от бота. Незавершённые доставки будут отменены.`
              : "Пользователь больше не будет получать сообщения от бота."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={isPending}
            onClick={onCancel}
            type="button"
            variant="outline"
          >
            Отмена
          </Button>
          <Button
            disabled={isPending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {isPending ? "Останавливаем…" : "Остановить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
