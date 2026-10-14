import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { useReportsQuery, useUpdateReportStatusMutation } from "./queries";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
} from "./labels";
import type { UpdateReportStatusDto } from "@edem/contracts";

type ReportStatusFilter = "pending" | "in_review" | "resolved" | "rejected";

const REPORT_STATUS_FILTERS: readonly ReportStatusFilter[] = [
  "pending",
  "in_review",
  "resolved",
  "rejected",
];

/**
 * DOM select возвращает произвольную строку — проверяем её рантайм-гвардом
 * ДО попадания в query-параметры, а не слепым cast (audit: unchecked cast).
 * Неизвестное значение молча игнорируется (фильтр не меняется).
 */
function isReportStatusFilter(value: string): value is ReportStatusFilter {
  return (REPORT_STATUS_FILTERS as readonly string[]).includes(value);
}

interface MutationFeedback {
  tone: "success" | "error";
  text: string;
}

export function ReportsPage() {
  const [status, setStatus] = useState<ReportStatusFilter | undefined>(
    "pending",
  );
  const [page, setPage] = useState(1);
  const query = useReportsQuery({ status, page, pageSize: 20 });
  const mutation = useUpdateReportStatusMutation();
  const [note, setNote] = useState<Record<string, string>>({});
  // Обратная связь модерации: успех/сбой обязаны быть объявлены (audit:
  // мутации без анонса выглядели как «ничего не произошло»).
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);

  const runStatusUpdate = (
    reportId: string,
    data: UpdateReportStatusDto,
    successText: string,
  ) => {
    mutation.mutate(
      { id: reportId, data },
      {
        onSuccess: () => setFeedback({ tone: "success", text: successText }),
        onError: (error) =>
          setFeedback({
            tone: "error",
            text:
              error instanceof Error
                ? error.message
                : "Не удалось обновить статус жалобы",
          }),
      },
    );
  };

  return (
    <section className="grid gap-4" aria-labelledby="reports-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="reports-heading" className="text-2xl font-semibold">
          Жалобы
        </h1>
        <label
          htmlFor="reports-status-filter"
          className="text-sm text-muted-foreground"
        >
          Статус
        </label>
        <select
          id="reports-status-filter"
          aria-label="Фильтр жалоб по статусу"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={status ?? "all"}
          onChange={(event) => {
            const next = event.target.value;
            if (next !== "all" && !isReportStatusFilter(next)) return;
            setPage(1);
            setStatus(next === "all" ? undefined : next);
          }}
        >
          <option value="all">Все</option>
          <option value="pending">Новые</option>
          <option value="in_review">В работе</option>
          <option value="resolved">Решённые</option>
          <option value="rejected">Отклонённые</option>
        </select>
      </div>
      {feedback && (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            feedback.tone === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {feedback.text}
        </p>
      )}
      {query.isPending && <p role="status">Загрузка...</p>}
      {query.isError && (
        <p role="alert" className="text-destructive">
          {query.error.message}
        </p>
      )}
      {query.data?.items.length === 0 && (
        <p role="status" className="text-muted-foreground">
          Жалоб нет
        </p>
      )}
      <div className="grid gap-3">
        {query.data?.items.map((report) => (
          <article key={report.id} className="grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {REPORT_STATUS_LABELS[report.status]}
              </Badge>
              <Badge variant="secondary">
                {REPORT_CATEGORY_LABELS[report.category]}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {REPORT_TARGET_TYPE_LABELS[report.targetType]} ·{" "}
                {report.reporterName} · {formatDateTime(report.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{report.description}</p>
            {report.status !== "resolved" && report.status !== "rejected" && (
              <>
                <label
                  htmlFor={`report-note-${report.id}`}
                  className="text-sm text-muted-foreground"
                >
                  Комментарий модератора
                </label>
                <Textarea
                  id={`report-note-${report.id}`}
                  placeholder="Комментарий модератора"
                  value={note[report.id] ?? ""}
                  onChange={(event) =>
                    setNote((current) => ({
                      ...current,
                      [report.id]: event.target.value,
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() =>
                      runStatusUpdate(report.id, {
                        status: "in_review",
                        resolutionNote: note[report.id],
                      }, "Жалоба переведена в работу")
                    }
                  >
                    В работу
                  </Button>
                  <Button
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() =>
                      runStatusUpdate(report.id, {
                        status: "resolved",
                        resolutionNote: note[report.id],
                      }, "Жалоба решена")
                    }
                  >
                    Решить
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={mutation.isPending}
                    onClick={() =>
                      runStatusUpdate(report.id, {
                        status: "rejected",
                        resolutionNote: note[report.id],
                      }, "Жалоба отклонена")
                    }
                  >
                    Отклонить
                  </Button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {query.data && (
        <nav aria-label="Пагинация жалоб" className="flex gap-2">
          <Button
            variant="outline"
            aria-label="Предыдущая страница жалоб"
            disabled={page === 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Назад
          </Button>
          <span role="status" className="px-2 py-2 text-sm">
            Страница {page} из {Math.max(1, query.data.pagination.totalPages)}
          </span>
          <Button
            variant="outline"
            aria-label="Следующая страница жалоб"
            disabled={!query.data.pagination.hasMore}
            onClick={() => setPage((current) => current + 1)}
          >
            Вперёд
          </Button>
        </nav>
      )}
    </section>
  );
}
