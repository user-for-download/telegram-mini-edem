import type {
  AdminReviewDetailDto,
  AdminReviewPartySummaryDto,
  ReviewStatusValue,
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

import { useReviewDetailQuery } from "./queries";

const STATUS_LABELS: Record<ReviewStatusValue, string> = {
  pending: "На модерации",
  published: "Опубликован",
  rejected: "Отклонён",
};

export function ReviewDetailDialog({
  reviewId,
  onClose,
}: {
  reviewId: string | null;
  onClose: () => void;
}) {
  const query = useReviewDetailQuery(reviewId);
  const open = Boolean(reviewId);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {query.isPending && (
          <div className="grid gap-3" role="status" aria-label="Загрузка отзыва">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {query.isError && (
          <Alert variant="destructive">
            <AlertTitle>Не удалось загрузить отзыв</AlertTitle>
            <AlertDescription>
              {query.error?.message ?? "Неизвестная ошибка"}
            </AlertDescription>
          </Alert>
        )}
        {query.data && <ReviewDetail review={query.data} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ReviewDetail({
  review,
  onClose,
}: {
  review: AdminReviewDetailDto;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Отзыв</DialogTitle>
        <DialogDescription>
          {review.tripRoute} · {formatDateTime(review.createdAt)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={review.status === "published" ? "secondary" : "outline"}>
            {STATUS_LABELS[review.status]}
          </Badge>
          <Badge variant="outline">{review.rating} ★</Badge>
          <Badge variant="secondary">{review.targetRole}</Badge>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">
            Текст отзыва
          </h3>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
            {review.text}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <PartyCard label="Автор" party={review.author} />
          <PartyCard label="Получатель" party={review.target} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Закрыть
        </Button>
      </DialogFooter>
    </>
  );
}

function PartyCard({
  label,
  party,
}: {
  label: string;
  party: AdminReviewPartySummaryDto;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <img
          alt=""
          className="size-9 shrink-0 rounded-full object-cover"
          src={party.avatar}
        />
        <div className="min-w-0">
          <Link
            className="block truncate font-medium underline-offset-2 hover:underline"
            search={{ id: party.id }}
            to="/users"
          >
            {party.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            Рейтинг {party.rating.toFixed(1)}
          </p>
        </div>
      </div>
      {party.bannedAt && (
        <Badge className="mt-2" variant="destructive">
          Заблокирован
        </Badge>
      )}
    </div>
  );
}
