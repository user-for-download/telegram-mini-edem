import { useEffect, useState } from "react";
import { AlertCircle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { ApiError } from "@/lib/api-client";
import { CITY_NAME_MAX_LENGTH } from "@edem/contracts";

import {
  useCitiesQuery,
  useCreateCityMutation,
  useDeleteCityMutation,
  useUpdateCityMutation,
} from "./queries";

const PAGE_SIZE = 50;

interface CityFormState {
  name: string;
  /** Серверные ошибки полей (из 400 VALIDATION_FAILED с `errors`). */
  fieldError?: string;
}

const EMPTY_FORM: CityFormState = { name: "" };

/**
 * Управление справочником точек: список + создание + переименование
 * + удаление. Удаление запрещено сервером, если на город ссылается
 * хотя бы одна поездка (409 Conflict) — UI показывает сообщение
 * с количеством поездок.
 */
export function CitiesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Локальный дебаунс ввода поиска (300мс): сокращает число запросов при
  // наборе без видимой задержки для пользователя. Функциональные апдейтеры
  // с bail-out (то же значение → без ререндера) гарантируют ровно одну
  // загрузку на маунт/изменение параметров, в т.ч. в StrictMode.
  useEffect(() => {
    const trimmed = search.trim();
    const handle = setTimeout(() => {
      setDebouncedSearch((prev) => (prev === trimmed ? prev : trimmed));
      setPage((prev) => (prev === 1 ? prev : 1));
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const citiesQuery = useCitiesQuery({
    page,
    pageSize: PAGE_SIZE,
    q: debouncedSearch || undefined,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    fieldError?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    name: string;
    tripsCount: number;
  } | null>(null);

  return (
    <section className="grid gap-4" aria-labelledby="cities-page-title">
      <div className="flex items-center justify-between gap-3">
        <h1 id="cities-page-title" className="text-2xl font-semibold">Города</h1>
        <Button onClick={() => setCreateOpen(true)}>Добавить город</Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="search"
          aria-label="Поиск городов по названию"
          placeholder="Поиск по названию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {debouncedSearch && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setPage(1);
            }}
          >
            Сбросить
          </Button>
        )}
      </div>

      {citiesQuery.isPending && <CitiesLoading />}
      {citiesQuery.isError && (
        <CitiesError
          message={citiesQuery.error?.message ?? "Неизвестная ошибка"}
          onRetry={() => void citiesQuery.refetch()}
        />
      )}
      {citiesQuery.data && (
        <>
          <CitiesTable
            cities={citiesQuery.data.items}
            onEdit={(city) =>
              setEditing({ id: city.id, name: city.name })
            }
            onDelete={(city) =>
              setDeleting({
                id: city.id,
                name: city.name,
                tripsCount: city.tripsCount,
              })
            }
          />
          <CitiesPagination
            data={citiesQuery.data}
            page={page}
            onPageChange={setPage}
          />
        </>
      )}

      <CreateCityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      {editing && (
        <EditCityDialog
          state={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCityDialog
          state={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Подкомпоненты: таблица, диалоги, состояния
// ────────────────────────────────────────────────────────────────────────────

function CitiesTable({
  cities,
  onEdit,
  onDelete,
}: {
  cities: ReadonlyArray<{
    id: string;
    name: string;
    tripsCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  onEdit: (city: { id: string; name: string }) => void;
  onDelete: (city: { id: string; name: string; tripsCount: number }) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Название</TableHead>
          <TableHead className="w-24 text-right">Поездок</TableHead>
          <TableHead>Создан</TableHead>
          <TableHead>Обновлён</TableHead>
          <TableHead className="w-32 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cities.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={5}
              className="h-24 text-center text-muted-foreground"
            >
              Городов нет
            </TableCell>
          </TableRow>
        ) : (
          cities.map((city) => (
            <TableRow key={city.id}>
              <TableCell className="font-medium">{city.name}</TableCell>
              <TableCell className="text-right">
                <Badge variant={city.tripsCount > 0 ? "default" : "secondary"}>
                  {city.tripsCount}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {formatDateTime(city.createdAt)}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {formatDateTime(city.updatedAt)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onEdit(city)}
                    aria-label={`Переименовать ${city.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(city)}
                    aria-label={`Удалить ${city.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function CreateCityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<CityFormState>(EMPTY_FORM);
  const create = useCreateCityMutation();
  // create — новый объект каждый рендер (спред результата useMutation),
  // его нельзя класть в deps: смена статуса pending→error перезапускала бы
  // эффект, стирая ввод и сбрасывая ошибку. reset привязан в конструкторе
  // MutationObserver — стабильная ссылка, безопасна для deps.
  const resetCreate = create.reset;

  // Сброс формы при открытии — фазой рендера (setState в эффекте запрещён
  // react-hooks/set-state-in-effect). Сброс мутации — эффектом: это внешний
  // стор, а не React state, семантически это подписка на open.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setForm(EMPTY_FORM);
  }
  useEffect(() => {
    if (open) resetCreate();
  }, [open, resetCreate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setForm({ name, fieldError: "Имя города обязательно" });
      return;
    }
    create.mutate(name, {
      onSuccess: (city) => {
        toast.success(`Город «${city.name}» добавлен`);
        onOpenChange(false);
      },
      onError: (error) => handleMutationError(error, setForm),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый город</DialogTitle>
          <DialogDescription>
            Имя появится в автодополнении у водителей при создании поездки.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="create-city-name">Название</Label>
            <Input
              id="create-city-name"
              maxLength={CITY_NAME_MAX_LENGTH}
              value={form.name}
              onChange={(e) =>
                setForm({ name: e.target.value, fieldError: undefined })
              }
              aria-invalid={Boolean(form.fieldError)}
            />
            {form.fieldError && (
              <p className="text-xs text-destructive" role="alert">
                {form.fieldError}
              </p>
            )}
          </div>
          {create.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Не удалось создать город</AlertTitle>
              <AlertDescription>
                {create.error instanceof ApiError
                  ? create.error.message
                  : "Неизвестная ошибка"}
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCityDialog({
  state,
  onClose,
}: {
  state: { id: string; name: string; fieldError?: string };
  onClose: () => void;
}) {
  const [form, setForm] = useState<CityFormState>({
    name: state.name,
    fieldError: state.fieldError,
  });
  const update = useUpdateCityMutation();
  // См. CreateCityDialog: объект мутации нестабилен, используем стабильный reset.
  const resetUpdate = update.reset;

  // Сброс формы при смене цели — фазой рендера (см. CreateCityDialog);
  // сброс мутации — эффектом с исходными deps (тайминг 1:1).
  const [prevId, setPrevId] = useState(state.id);
  if (state.id !== prevId) {
    setPrevId(state.id);
    setForm({ name: state.name, fieldError: state.fieldError });
  }
  useEffect(() => {
    resetUpdate();
  }, [state.id, state.name, state.fieldError, resetUpdate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setForm({ name, fieldError: "Имя города обязательно" });
      return;
    }
    update.mutate(
      { id: state.id, name },
      {
        onSuccess: (city) => {
          toast.success(`Город переименован в «${city.name}»`);
          onClose();
        },
        onError: (error) => handleMutationError(error, setForm),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Переименовать город</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="edit-city-name">Название</Label>
            <Input
              id="edit-city-name"
              maxLength={CITY_NAME_MAX_LENGTH}
              value={form.name}
              onChange={(e) =>
                setForm({ name: e.target.value, fieldError: undefined })
              }
              aria-invalid={Boolean(form.fieldError)}
            />
            {form.fieldError && (
              <p className="text-xs text-destructive" role="alert">
                {form.fieldError}
              </p>
            )}
          </div>
          {update.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Не удалось переименовать</AlertTitle>
              <AlertDescription>
                {update.error instanceof ApiError
                  ? update.error.message
                  : "Неизвестная ошибка"}
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCityDialog({
  state,
  onClose,
}: {
  state: { id: string; name: string; tripsCount: number };
  onClose: () => void;
}) {
  const remove = useDeleteCityMutation();
  const blocked = state.tripsCount > 0;

  const handleConfirm = () => {
    remove.mutate(state.id, {
      onSuccess: () => {
        toast.success(`Город «${state.name}» удалён`);
        onClose();
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить «{state.name}»?</DialogTitle>
          <DialogDescription>
            {blocked
              ? `Невозможно удалить: на этот город ссылается ${state.tripsCount} поездок. Сначала переименуйте или удалите их, либо перенесите на другой город.`
              : "Действие необратимо. Город исчезнет из автодополнения у водителей."}
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Не удалось удалить</AlertTitle>
            <AlertDescription>
              {remove.error instanceof ApiError
                ? remove.error.message
                : "Неизвестная ошибка"}
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={blocked || remove.isPending}
          >
            {remove.isPending ? "Удаление…" : "Удалить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CitiesPagination({
  data,
  page,
  onPageChange,
}: {
  data: { pagination: { totalPages: number; hasMore: boolean } };
  page: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav className="flex items-center justify-between text-sm text-muted-foreground" aria-label="Навигация по страницам городов">
      <span aria-live="polite">Страница {page} из {data.pagination.totalPages}</span>
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
          disabled={!data.pagination.hasMore}
          onClick={() => onPageChange(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </nav>
  );
}

function CitiesLoading() {
  return (
    <div className="grid gap-2" role="status" aria-label="Загрузка городов">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function CitiesError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Не удалось загрузить города</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction onClick={onRetry}>Повторить</AlertAction>
    </Alert>
  );
}

/**
 * Маппинг ApiError → пользовательское сообщение в форме. 409 → текст
 * с сервера (там уже «Город с таким именем уже существует»). Иначе —
 * общее сообщение по статусу.
 */
function handleMutationError(
  error: unknown,
  setForm: (s: CityFormState) => void,
): void {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      setForm({ name: "", fieldError: "Город с таким именем уже существует" });
      return;
    }
    if (error.status === 400) {
      setForm({ name: "", fieldError: error.message });
      return;
    }
  }
  setForm({ name: "", fieldError: undefined });
}
