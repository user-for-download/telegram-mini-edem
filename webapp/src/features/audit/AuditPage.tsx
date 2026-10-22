import { useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
  type AdminAuditAction,
  type AdminAuditLogDto,
  type AdminAuditTargetType,
  type AdminPaginatedAuditLog,
} from "@edem/contracts";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

import { useAuditQuery } from "./queries";

const PAGE_SIZE = 20;

const ACTION_LABELS: Record<AdminAuditAction, string> = {
  "user.ban": "Бан пользователя",
  "user.unban": "Разбан пользователя",
  "user.onboarding_reset": "Сброс онбординга",
  "user.telegram_stop": "Стоп Telegram",
  "trip.cancel": "Отмена поездки",
  "booking.status": "Смена статуса брони",
  "review.approve": "Одобрение отзыва",
  "review.reject": "Отклонение отзыва",
  "review.delete": "Удаление отзыва",
  "feedback.reply": "Ответ на обращение",
  "report.status": "Смена статуса жалобы",
  "city.create": "Создание города",
  "city.update": "Переименование города",
  "city.delete": "Удаление города",
  "city.recompute": "Пересчёт счётчиков городов",
};

const TARGET_LABELS: Record<AdminAuditTargetType, string> = {
  user: "Пользователь",
  trip: "Поездка",
  booking: "Бронь",
  review: "Отзыв",
  feedback: "Обращение",
  report: "Жалоба",
  city: "Город",
  system: "Система",
};

const isAuditAction = (value: string): value is AdminAuditAction =>
  (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(value);

const isTargetType = (value: string): value is AdminAuditTargetType =>
  (ADMIN_AUDIT_TARGET_TYPES as readonly string[]).includes(value);

export function AuditPage() {
  const [action, setAction] = useState<AdminAuditAction | "all">("all");
  const [targetType, setTargetType] = useState<AdminAuditTargetType | "all">(
    "all",
  );
  const [targetId, setTargetId] = useState("");
  const [page, setPage] = useState(1);
  const query = useAuditQuery({
    action: action === "all" ? undefined : action,
    targetType: targetType === "all" ? undefined : targetType,
    targetId,
    page,
    pageSize: PAGE_SIZE,
  });
  const currentPage = useClampedPageIndex(
    page,
    query.data ? countPages(query.data.total, query.data.pageSize) : undefined,
    setPage,
  );

  return (
    <section className="grid gap-4" aria-labelledby="audit-page-title">
      <div>
        <h1 className="text-2xl font-semibold" id="audit-page-title">
          Аудит действий
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only журнал админ-мутаций: только идентификаторы, статусы и
          счётчики.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <select
          aria-label="Фильтр аудита по действию"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={action}
          onChange={(event) => {
            const next = event.target.value;
            if (next !== "all" && !isAuditAction(next)) return;
            setAction(next === "all" ? "all" : next);
            setPage(1);
          }}
        >
          <option value="all">Все действия</option>
          {ADMIN_AUDIT_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {ACTION_LABELS[value]}
            </option>
          ))}
        </select>
        <select
          aria-label="Фильтр аудита по типу цели"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={targetType}
          onChange={(event) => {
            const next = event.target.value;
            if (next !== "all" && !isTargetType(next)) return;
            setTargetType(next === "all" ? "all" : next);
            setPage(1);
          }}
        >
          <option value="all">Все цели</option>
          {ADMIN_AUDIT_TARGET_TYPES.map((value) => (
            <option key={value} value={value}>
              {TARGET_LABELS[value]}
            </option>
          ))}
        </select>
        <Input
          aria-label="Фильтр аудита по id цели"
          placeholder="ID цели"
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {query.isPending && <AuditLoading />}
      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Не удалось загрузить аудит</AlertTitle>
          <AlertDescription>
            {query.error?.message ?? "Неизвестная ошибка"}
          </AlertDescription>
          <AlertAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              Повторить
            </Button>
          </AlertAction>
        </Alert>
      )}
      {query.data && (
        <>
          <AuditTable items={query.data.items} />
          <AuditPagination
            data={query.data}
            page={currentPage}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}

function AuditTable({ items }: { items: AdminAuditLogDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Дата</TableHead>
          <TableHead>Действие</TableHead>
          <TableHead>Цель</TableHead>
          <TableHead>ID цели</TableHead>
          <TableHead>Детали</TableHead>
          <TableHead>Актор</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell
              className="h-24 text-center text-muted-foreground"
              colSpan={6}
            >
              Записей нет
            </TableCell>
          </TableRow>
        ) : (
          items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap">
                {formatDateTime(item.createdAt)}
              </TableCell>
              <TableCell>{ACTION_LABELS[item.action]}</TableCell>
              <TableCell>{TARGET_LABELS[item.targetType]}</TableCell>
              <TableCell className="max-w-48 truncate font-mono text-xs">
                {item.targetId ?? "—"}
              </TableCell>
              <TableCell className="max-w-72 truncate font-mono text-xs">
                {item.metadata ? JSON.stringify(item.metadata) : "—"}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{item.actorType}</Badge>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function AuditPagination({
  data,
  page,
  onPageChange,
}: {
  data: AdminPaginatedAuditLog;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = countPages(data.total, data.pageSize);
  return (
    <nav
      aria-label="Навигация по страницам аудита"
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <p aria-live="polite" className="text-sm text-muted-foreground">
        стр. {page} из {totalPages} · всего записей: {data.total}
      </p>
      <div className="flex gap-2">
        <Button
          disabled={page <= 1}
          size="sm"
          variant="outline"
          onClick={() => onPageChange(page - 1)}
        >
          Назад
        </Button>
        <Button
          disabled={page >= totalPages}
          size="sm"
          variant="outline"
          onClick={() => onPageChange(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </nav>
  );
}

function AuditLoading() {
  return (
    <div
      aria-label="Загрузка аудита"
      className="grid gap-2"
      role="status"
    >
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
