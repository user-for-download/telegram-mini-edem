import { useState } from "react";
import { AlertCircle } from "lucide-react";
import type {
  AdminPaginatedReviews,
  AdminReviewDto,
  ReviewStatusValue,
} from "@edem/contracts";

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
import { ApiError } from "@/lib/api-client";

import {
  useApproveReviewMutation,
  useDeleteReviewMutation,
  useRejectReviewMutation,
  useReviewsQuery,
} from "./queries";

const PAGE_SIZE = 10;

// Подписи статусов в таблице (ед. ч.) и в фильтре (мн. ч.) — разные по смыслу.
const STATUS_LABELS: Record<ReviewStatusValue, string> = {
  pending: "На модерации",
  published: "Опубликован",
  rejected: "Отклонён",
};

const STATUS_FILTER_OPTIONS: { value: ReviewStatusValue; label: string }[] = [
  { value: "pending", label: "На модерации" },
  { value: "published", label: "Опубликованные" },
  { value: "rejected", label: "Отклонённые" },
];

type StatusFilterValue = ReviewStatusValue | "all";

type ModerationAction = "approve" | "reject";

interface PendingModeration {
  review: AdminReviewDto;
  action: ModerationAction;
}

export function ReviewsPage() {
  const [status, setStatus] = useState<StatusFilterValue>("all");
  const [page, setPage] = useState(1);
  const [reviewToDelete, setReviewToDelete] = useState<AdminReviewDto | null>(
    null
  );
  const [pendingModeration, setPendingModeration] =
    useState<PendingModeration | null>(null);
  const [moderateError, setModerateError] = useState<string | null>(null);
  const reviewsQuery = useReviewsQuery({
    status: status === "all" ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const deleteMutation = useDeleteReviewMutation();
  const approveMutation = useApproveReviewMutation();
  const rejectMutation = useRejectReviewMutation();
  const isModerating = approveMutation.isPending || rejectMutation.isPending;

  // Модерация последнего отзыва на странице сжимает выборку — индекс не должен
  // уезжать за totalPages, иначе таблица выглядит пустой (audit F8).
  const currentPage = useClampedPageIndex(
    page,
    reviewsQuery.data
      ? countPages(reviewsQuery.data.total, reviewsQuery.data.pageSize)
      : undefined,
    setPage,
  );

  const handleFilterChange = (next: StatusFilterValue) => {
    setStatus(next);
    setPage(1);
  };

  const confirmDelete = () => {
    if (!reviewToDelete) return;
    deleteMutation.mutate(reviewToDelete.id, {
      onSuccess: () => setReviewToDelete(null),
    });
  };

  const requestModeration = (review: AdminReviewDto, action: ModerationAction) => {
    setModerateError(null);
    setPendingModeration({ review, action });
  };

  const closeModerationDialog = () => {
    if (isModerating) return;
    setPendingModeration(null);
    setModerateError(null);
  };

  // Одобрение/отклонение — только через явный confirm-диалог.
  // 409 (отзыв уже обработан) закрывает диалог: хук уже инвалидировал
  // кэш и показал тост, список подтянет актуальный статус.
  // Прочие ошибки показываем инлайном в диалоге + тостом из хука.
  const confirmModeration = () => {
    if (!pendingModeration || isModerating) return;
    const mutation =
      pendingModeration.action === "approve" ? approveMutation : rejectMutation;
    mutation.mutate(pendingModeration.review.id, {
      onSuccess: () => {
        setPendingModeration(null);
        setModerateError(null);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          setPendingModeration(null);
          setModerateError(null);
          return;
        }
        setModerateError(
          error instanceof Error ? error.message : "Неизвестная ошибка"
        );
      },
    });
  };

  return (
    <section className="grid gap-4" aria-labelledby="reviews-page-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
            <h1 id="reviews-page-title" className="text-2xl font-semibold">Отзывы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Модерация отзывов: одобрение, отклонение и фильтр по статусу.
          </p>
        </div>
        <StatusFilter value={status} onChange={handleFilterChange} />
      </div>
      {reviewsQuery.isPending && <ReviewsLoading />}
      {reviewsQuery.isError && (
        <ReviewsError
          message={reviewsQuery.error?.message ?? "Неизвестная ошибка"}
          onRetry={() => void reviewsQuery.refetch()}
        />
      )}
      {reviewsQuery.data && (
        <>
          <ReviewsTable
            reviews={reviewsQuery.data.items}
            moderating={isModerating}
            onDelete={setReviewToDelete}
            onModerate={requestModeration}
          />
          <ReviewsPagination
            data={reviewsQuery.data}
            page={currentPage}
            onPageChange={setPage}
          />
        </>
      )}
      <DeleteReviewDialog
        review={reviewToDelete}
        isPending={deleteMutation.isPending}
        onClose={() => setReviewToDelete(null)}
        onConfirm={confirmDelete}
      />
      <ModerateReviewDialog
        pending={pendingModeration}
        isPending={isModerating}
        error={moderateError}
        onClose={closeModerationDialog}
        onConfirm={confirmModeration}
      />
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
      onValueChange={(next) => onChange(next as StatusFilterValue)}
    >
      <SelectTrigger aria-label="Фильтр по статусу" className="w-48">
        <SelectValue placeholder="Все" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Все</SelectItem>
        {STATUS_FILTER_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ReviewStatusBadge({ status }: { status: ReviewStatusValue }) {
  if (status === "pending") {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-500/15 text-amber-700 dark:text-amber-400"
      >
        {STATUS_LABELS.pending}
      </Badge>
    );
  }
  if (status === "published") {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/15 text-green-700 dark:text-green-400"
      >
        {STATUS_LABELS.published}
      </Badge>
    );
  }
  return <Badge variant="destructive">{STATUS_LABELS.rejected}</Badge>;
}

function ReviewsTable({
  reviews,
  moderating,
  onDelete,
  onModerate,
}: {
  reviews: AdminReviewDto[];
  moderating: boolean;
  onDelete: (review: AdminReviewDto) => void;
  onModerate: (review: AdminReviewDto, action: ModerationAction) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Автор</TableHead>
          <TableHead>Кому</TableHead>
          <TableHead>Оценка</TableHead>
          <TableHead>Текст</TableHead>
          <TableHead>Маршрут</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Дата</TableHead>
          <TableHead>Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={8}
              className="h-24 text-center text-muted-foreground"
            >
              Отзывов нет
            </TableCell>
          </TableRow>
        ) : (
          reviews.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              moderating={moderating}
              onDelete={onDelete}
              onModerate={onModerate}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}

function ReviewRow({
  review,
  moderating,
  onDelete,
  onModerate,
}: {
  review: AdminReviewDto;
  moderating: boolean;
  onDelete: (review: AdminReviewDto) => void;
  onModerate: (review: AdminReviewDto, action: ModerationAction) => void;
}) {
  return (
    <TableRow>
      <TableCell>{review.authorName}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {review.targetUserName}
          <Badge variant="secondary">{review.targetRole}</Badge>
        </div>
      </TableCell>
      <TableCell>{review.rating} ★</TableCell>
      <TableCell className="max-w-64 truncate" title={review.text}>
        {review.text}
      </TableCell>
      <TableCell>{review.tripRoute}</TableCell>
      <TableCell>
        <ReviewStatusBadge status={review.status} />
      </TableCell>
      <TableCell>{formatDateTime(review.createdAt)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {review.status === "pending" && (
            <>
              <Button
                size="sm"
                disabled={moderating}
                onClick={() => onModerate(review, "approve")}
              >
                Одобрить
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={moderating}
                onClick={() => onModerate(review, "reject")}
              >
                Отклонить
              </Button>
            </>
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={moderating}
            onClick={() => onDelete(review)}
          >
            Удалить
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ReviewsPagination({
  data,
  page,
  onPageChange,
}: {
  data: AdminPaginatedReviews;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = countPages(data.total, data.pageSize);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Навигация по страницам отзывов">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        стр. {page} из {totalPages} · всего отзывов: {data.total}
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
    </nav>
  );
}

function DeleteReviewDialog({
  review,
  isPending,
  onClose,
  onConfirm,
}: {
  review: AdminReviewDto | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить отзыв?</DialogTitle>
          <DialogDescription>
            {review
              ? `Отзыв от ${review.authorName} о ${review.targetUserName} (${review.tripRoute}) будет удалён безвозвратно. Это действие нельзя отменить.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Отмена
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Удаление..." : "Удалить отзыв"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModerateReviewDialog({
  pending,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  pending: PendingModeration | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isApprove = pending?.action === "approve";

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isApprove ? "Одобрить отзыв?" : "Отклонить отзыв?"}
          </DialogTitle>
          <DialogDescription>
            {pending
              ? isApprove
                ? `Отзыв от ${pending.review.authorName} о ${pending.review.targetUserName} (${pending.review.tripRoute}) станет публичным и начнёт учитываться в рейтинге.`
                : `Отзыв от ${pending.review.authorName} о ${pending.review.targetUserName} (${pending.review.tripRoute}) будет скрыт из публичного списка.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertTitle>Не удалось выполнить действие</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Отмена
            </Button>
          </DialogClose>
          <Button
            variant={isApprove ? "default" : "destructive"}
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending
              ? "Выполнение..."
              : isApprove
                ? "Одобрить отзыв"
                : "Отклонить отзыв"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewsLoading() {
  return (
    <div className="grid gap-3" role="status" aria-label="Загрузка отзывов">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function ReviewsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Не удалось загрузить отзывы</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      </AlertAction>
    </Alert>
  );
}
