import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Pencil } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type {
  AdminFeedbackDto,
  AdminPaginatedFeedback,
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { countPages } from "@/lib/page-clamp";
import { useClampedPageIndex } from "@/lib/use-clamped-page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";

import {
  useCreateFeedbackReplyMutation,
  useFeedbackDetailQuery,
  useFeedbackQuery,
  useUpdateFeedbackReplyMutation,
} from "./queries";

const PAGE_SIZE = 10;
const FEEDBACK_REPLY_MAX_LENGTH = 2000;

function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Список обращений пользователей в поддержку + диалог детальной карточки
 * с формой ответа админа (POST/PUT /admin/feedback/:id/reply).
 */
export function FeedbackPage() {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [answered, setAnswered] = useState<"all" | "true" | "false">("all");
  const q = useDebouncedValue(search.trim());
  const feedbackQuery = useFeedbackQuery({
    answered: answered === "all" ? undefined : answered,
    q: q || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const currentPage = useClampedPageIndex(
    page,
    feedbackQuery.data
      ? countPages(feedbackQuery.data.total, feedbackQuery.data.pageSize)
      : undefined,
    setPage,
  );

  return (
    <section className="grid gap-4" aria-labelledby="feedback-page-title">
      <h1 id="feedback-page-title" className="text-2xl font-semibold">Обратная связь</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Поиск обращений по теме, тексту или имени"
          className="max-w-sm"
          placeholder="Тема, текст или имя"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Фильтр обращений по наличию ответа"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={answered}
          onChange={(event) => {
            setAnswered(event.target.value as "all" | "true" | "false");
            setPage(1);
          }}
        >
          <option value="all">Все</option>
          <option value="false">Без ответа</option>
          <option value="true">Отвеченные</option>
        </select>
      </div>
      {feedbackQuery.isPending && <FeedbackLoading />}
      {feedbackQuery.isError && (
        <FeedbackError
          message={feedbackQuery.error?.message ?? "Неизвестная ошибка"}
          onRetry={() => void feedbackQuery.refetch()}
        />
      )}
      {feedbackQuery.data && (
        <>
          <FeedbackTable
            feedbacks={feedbackQuery.data.items}
            onOpen={setOpenId}
          />
          <FeedbackPagination
            data={feedbackQuery.data}
            page={currentPage}
            onPageChange={setPage}
          />
        </>
      )}

      <FeedbackDetailDialog
        feedbackId={openId}
        onClose={() => setOpenId(null)}
      />
    </section>
  );
}

function FeedbackTable({
  feedbacks,
  onOpen,
}: {
  feedbacks: AdminFeedbackDto[];
  onOpen: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Дата</TableHead>
          <TableHead>Пользователь</TableHead>
          <TableHead>Тема</TableHead>
          <TableHead>Сообщение</TableHead>
          <TableHead>Статус</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {feedbacks.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={5}
              className="h-24 text-center text-muted-foreground"
            >
              Обращений нет
            </TableCell>
          </TableRow>
        ) : (
          feedbacks.map((feedback) => (
            <TableRow
              key={feedback.id}
              className="cursor-pointer focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none"
              tabIndex={0}
              role="button"
              aria-label={`Открыть обращение: ${feedback.subject}`}
              onClick={() => onOpen(feedback.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(feedback.id);
                }
              }}
            >
              <TableCell className="whitespace-nowrap">
                {formatDateTime(feedback.createdAt)}
              </TableCell>
              <TableCell>
                <Link
                  className="underline-offset-2 hover:underline"
                  search={{ id: feedback.userId }}
                  to="/users"
                  onClick={(event) => event.stopPropagation()}
                >
                  {feedback.userName}
                </Link>
              </TableCell>
              <TableCell className="max-w-48 truncate" title={feedback.subject}>
                {feedback.subject}
              </TableCell>
              <TableCell className="max-w-96 truncate" title={feedback.text}>
                {feedback.text}
              </TableCell>
              <TableCell>
                {feedback.reply ? (
                  <Badge variant="default">Отвечено</Badge>
                ) : (
                  <Badge variant="outline">Ожидает</Badge>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function FeedbackDetailDialog({
  feedbackId,
  onClose,
}: {
  feedbackId: string | null;
  onClose: () => void;
}) {
  const detailQuery = useFeedbackDetailQuery(feedbackId);
  const open = Boolean(feedbackId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {detailQuery.isPending && (
          <div className="grid gap-3" role="status" aria-label="Загрузка обращения">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {detailQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Не удалось загрузить обращение</AlertTitle>
            <AlertDescription>
              {detailQuery.error?.message ?? "Неизвестная ошибка"}
            </AlertDescription>
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void detailQuery.refetch()}
              >
                Повторить
              </Button>
            </AlertAction>
          </Alert>
        )}
        {detailQuery.data && (
          <FeedbackDetailForm
            key={detailQuery.data.id}
            feedback={detailQuery.data}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FeedbackDetailForm({
  feedback,
  onClose,
}: {
  feedback: AdminFeedbackDto;
  onClose: () => void;
}) {
  // Если ответ уже есть — по умолчанию показываем read-only,
  // кнопка «Изменить» переключает в режим редактирования.
  const [editMode, setEditMode] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(feedback.reply ?? "");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateFeedbackReplyMutation();
  const updateMutation = useUpdateFeedbackReplyMutation();

  const trimmed = draft.trim();
  const tooLong = trimmed.length > FEEDBACK_REPLY_MAX_LENGTH;
  const isValid = trimmed.length > 0 && !tooLong;
  const isPending = createMutation.isPending || updateMutation.isPending;
  // Для уже отвеченного обращения форма открывается, только если админ
  // явно нажал «Изменить». Для нового — форма сразу открыта.
  const formOpen = !feedback.reply || editMode;

  const handleSubmit = () => {
    if (!isValid) {
      setError(
        tooLong
          ? `Максимум ${FEEDBACK_REPLY_MAX_LENGTH} символов`
          : "Введите текст ответа",
      );
      return;
    }
    setError(null);
    const onSuccess = () => {
      setEditMode(false);
    };
    const onError = (e: Error) => {
      setError(e.message);
    };
    if (feedback.reply) {
      updateMutation.mutate(
        { id: feedback.id, reply: trimmed },
        { onSuccess, onError },
      );
    } else {
      createMutation.mutate(
        { id: feedback.id, reply: trimmed },
        { onSuccess, onError },
      );
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{feedback.subject}</DialogTitle>
        <DialogDescription>
          {formatDateTime(feedback.createdAt)} · {feedback.userName}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">
            Сообщение пользователя
          </h3>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
            {feedback.text}
          </p>
        </div>

        {feedback.reply && !editMode && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">
                Ответ поддержки
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(feedback.reply ?? "");
                  setEditMode(true);
                }}
              >
                <Pencil />
                Изменить
              </Button>
            </div>
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
              {feedback.reply}
            </p>
            {feedback.repliedAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                <CheckCircle2 className="mr-1 inline-block size-3" />
                Отправлено: {formatDateTime(feedback.repliedAt)}
              </p>
            )}
          </div>
        )}

        {formOpen && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-muted-foreground">
              {feedback.reply ? "Изменить ответ" : "Ответ поддержки"}
            </h3>
            <label htmlFor="feedback-reply" className="sr-only">Ответ поддержки</label>
            <Textarea
              id="feedback-reply"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Напишите ответ пользователю…"
              rows={6}
              maxLength={FEEDBACK_REPLY_MAX_LENGTH}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "feedback-reply-error" : undefined}
            />
            <p
              className="mt-1 text-right text-xs text-muted-foreground"
              aria-live="polite"
            >
              {trimmed.length}/{FEEDBACK_REPLY_MAX_LENGTH}
            </p>
          </div>
        )}

        {error && (
          <Alert id="feedback-reply-error" variant="destructive">
            <AlertCircle />
            <AlertTitle>Не удалось отправить ответ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Закрыть
        </Button>
        {formOpen && (
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isPending}
          >
            {feedback.reply ? "Сохранить" : "Отправить"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function FeedbackPagination({
  data,
  page,
  onPageChange,
}: {
  data: AdminPaginatedFeedback;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Навигация по страницам обращений">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        стр. {data.page} из {totalPages} · всего обращений: {data.total}
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

function FeedbackLoading() {
  return (
    <div className="grid gap-3" role="status" aria-label="Загрузка обращений">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function FeedbackError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Не удалось загрузить обращения</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      </AlertAction>
    </Alert>
  );
}
