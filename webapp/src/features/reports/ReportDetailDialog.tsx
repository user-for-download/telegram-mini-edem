import type { AdminReportDto } from "@edem/contracts";
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
} from "./labels";
import { useReportDetailQuery } from "./queries";

/**
 * Read-only карточка жалобы из GET /admin/reports/:id.
 *
 * Модерация (в работу / решить / отклонить) остаётся в списке: диалог не
 * держит второй экземпляр мутации с собственным note-состоянием, а значит
 * не может разойтись с карточкой списка.
 */
export function ReportDetailDialog({
  reportId,
  onClose,
}: {
  reportId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useReportDetailQuery(reportId);

  return (
    <Dialog
      open={reportId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {detailQuery.data
              ? detailQuery.data.targetSummary?.label ??
                detailQuery.data.targetLabel
              : "Жалоба"}
          </DialogTitle>
          <DialogDescription>
            {detailQuery.data
              ? `ID: ${detailQuery.data.id} · ${formatDateTime(detailQuery.data.createdAt)}`
              : "Детали жалобы и контекст объекта"}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isPending && (
          <div
            aria-label="Загрузка жалобы"
            className="grid gap-3"
            role="status"
          >
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {detailQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Не удалось загрузить жалобу</AlertTitle>
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

        {detailQuery.data && <ReportDetailContent report={detailQuery.data} />}

        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportDetailContent({ report }: { report: AdminReportDto }) {
  const target = report.targetSummary;
  const adminActor = [report.adminActorName, report.adminActorId]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{REPORT_STATUS_LABELS[report.status]}</Badge>
        <Badge variant="secondary">
          {REPORT_CATEGORY_LABELS[report.category]}
        </Badge>
        <Badge variant="outline">
          {REPORT_TARGET_TYPE_LABELS[report.targetType]}
        </Badge>
      </div>

      <section className="grid gap-1 rounded-lg border p-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Объект жалобы
        </h3>
        <p className="font-medium break-words">
          {target?.label ?? report.targetLabel}
        </p>
        {target?.secondary && (
          <p className="text-sm text-muted-foreground">{target.secondary}</p>
        )}
        <p className="text-xs text-muted-foreground">
          ID: {target?.id ?? report.targetId}
        </p>
      </section>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <DetailItem
          label="Автор жалобы"
          value={`${report.reporterName} · ${report.reporterId}`}
        />
        <DetailItem label="Модератор" value={adminActor || "—"} />
        <DetailItem
          label="Создана"
          value={formatDateTime(report.createdAt)}
        />
        <DetailItem
          label="Обновлена"
          value={formatDateTime(report.updatedAt)}
        />
        <DetailItem
          label="Решена"
          value={
            report.resolvedAt ? formatDateTime(report.resolvedAt) : "—"
          }
        />
      </dl>

      <section>
        <h3 className="mb-1 text-sm font-medium text-muted-foreground">
          Описание
        </h3>
        <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
          {report.description}
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-muted-foreground">
          Комментарий модератора
        </h3>
        <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
          {report.resolutionNote ?? "—"}
        </p>
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-3 border-b border-border/60 py-1">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{value}</dd>
    </div>
  );
}
