import { useEffect, useMemo, useState } from "react";

import type { AdminUserDto } from "@edem/contracts";

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
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { countPages } from "@/lib/page-clamp";
import { useClampedPageIndex } from "@/lib/use-clamped-page";
import { cn } from "@/lib/utils";

import {
  useBanUserMutation,
  useResetOnboardingMutation,
  useUnbanUserMutation,
  useUsersQuery,
} from "./queries";
import { UserDetailDrawer } from "./UserDetailDrawer";

const PAGE_SIZE = 20;
const BAN_REASON_MAX = 500;
const BAN_REASON_MIN = 1;
const NO_REASON_LABEL = "Причина не указана";

function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Валидация причины бана: после trim должна быть непустой строкой (1–500).
 * Пробельная строка отвергается (защита от случайного пробела).
 */
function validateBanReason(raw: string): string | null {
  if (raw.trim().length < BAN_REASON_MIN) return "Укажите причину блокировки";
  if (raw.length > BAN_REASON_MAX) {
    return `Максимум ${BAN_REASON_MAX} символов`;
  }
  return null;
}

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [searchId, setSearchId] = useState("");
  const [searchTelegramId, setSearchTelegramId] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [page, setPage] = useState(1);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [banUserTarget, setBanUserTarget] = useState<AdminUserDto | null>(null);
  const [unbanUserTarget, setUnbanUserTarget] = useState<AdminUserDto | null>(
    null
  );
  const [resetUser, setResetUser] = useState<AdminUserDto | null>(null);
  const q = useDebouncedValue(search.trim());
  const id = useDebouncedValue(searchId.trim());
  const telegramUserId = useDebouncedValue(searchTelegramId.trim());
  const phone = useDebouncedValue(searchPhone.trim());

  const usersQuery = useUsersQuery({
    q: q || undefined,
    id: id || undefined,
    telegramUserId: telegramUserId || undefined,
    phone: phone || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  // Поиск/бан/разбан сжимают выборку — индекс страницы прижимается к
  // валидному, иначе таблица выглядит пустой (audit F8, тот же дефект).
  const currentPage = useClampedPageIndex(
    page,
    usersQuery.data ? countPages(usersQuery.data.total, usersQuery.data.pageSize) : undefined,
    setPage,
  );
  const banMutation = useBanUserMutation();
  const unbanMutation = useUnbanUserMutation();
  const resetOnboardingMutation = useResetOnboardingMutation();

  // Сбрасываем страницу синхронно с изменением любого фильтра (как в
  // BookingsPage/TripsPage): эффект после рендера успевал отправить запрос
  // с новым фильтром и старой страницей.
  const handleFilterChange = (
    setter: (value: string) => void,
    value: string,
  ) => {
    setter(value);
    setPage(1);
  };

  const handleBan = (user: AdminUserDto) => {
    setUnbanUserTarget(null);
    setBanUserTarget(user);
  };

  const handleUnban = (user: AdminUserDto) => {
    setBanUserTarget(null);
    setUnbanUserTarget(user);
  };

  const confirmUnban = () => {
    if (!unbanUserTarget) return;
    unbanMutation.mutate(unbanUserTarget.id, {
      onSuccess: () => setUnbanUserTarget(null),
    });
  };

  const confirmReset = () => {
    if (!resetUser) return;
    resetOnboardingMutation.mutate(resetUser.id, {
      onSuccess: () => setResetUser(null),
    });
  };

  return (
    <section className="grid gap-4" aria-labelledby="users-page-title">
      <div>
        <h1 id="users-page-title" className="text-2xl font-semibold">Пользователи</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Поиск пользователей, блокировка, разблокировка и сброс онбординга
        </p>
      </div>
      <div
        aria-label="Фильтры пользователей"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        role="group"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="users-search-name">Имя</Label>
          <Input
            autoComplete="off"
            id="users-search-name"
            onChange={(event) =>
              handleFilterChange(setSearch, event.target.value)
            }
            placeholder="Поиск по имени..."
            value={search}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="users-search-id">ID пользователя</Label>
          <Input
            autoComplete="off"
            id="users-search-id"
            onChange={(event) =>
              handleFilterChange(setSearchId, event.target.value)
            }
            placeholder="Точный ID"
            value={searchId}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="users-search-telegram">Telegram ID</Label>
          <Input
            autoComplete="off"
            id="users-search-telegram"
            inputMode="numeric"
            onChange={(event) =>
              handleFilterChange(setSearchTelegramId, event.target.value)
            }
            pattern="[0-9]*"
            placeholder="Только цифры"
            value={searchTelegramId}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="users-search-phone">Телефон</Label>
          <Input
            autoComplete="off"
            id="users-search-phone"
            inputMode="tel"
            onChange={(event) =>
              handleFilterChange(setSearchPhone, event.target.value)
            }
            placeholder="+7..."
            type="tel"
            value={searchPhone}
          />
        </div>
      </div>
      {usersQuery.isPending && <UsersTableSkeleton />}
      {usersQuery.isError && <UsersError message={usersQuery.error.message} />}
      {usersQuery.data && (
        <UsersTable
          users={usersQuery.data.items}
          onBan={handleBan}
          onDetails={(user) => setDetailUserId(user.id)}
          onUnban={handleUnban}
          onReset={setResetUser}
        />
      )}
      {usersQuery.data && (
        <Pagination
          page={currentPage}
          pageSize={usersQuery.data.pageSize}
          total={usersQuery.data.total}
          onPageChange={setPage}
        />
      )}
      <BanDialog
        user={banUserTarget}
        isPending={banMutation.isPending}
        onCancel={() => setBanUserTarget(null)}
        onConfirm={(reason) => {
          if (!banUserTarget) return;
          banMutation.mutate(
            { id: banUserTarget.id, body: { reason } },
            { onSuccess: () => setBanUserTarget(null) }
          );
        }}
      />
      <UnbanDialog
        user={unbanUserTarget}
        isPending={unbanMutation.isPending}
        onCancel={() => setUnbanUserTarget(null)}
        onConfirm={confirmUnban}
      />
      <ResetOnboardingDialog
        user={resetUser}
        isPending={resetOnboardingMutation.isPending}
        onCancel={() => setResetUser(null)}
        onConfirm={confirmReset}
      />
      <UserDetailDrawer
        userId={detailUserId}
        onClose={() => setDetailUserId(null)}
      />
    </section>
  );
}

function UsersTable({
  users,
  onBan,
  onDetails,
  onUnban,
  onReset,
}: {
  users: AdminUserDto[];
  onBan: (user: AdminUserDto) => void;
  onDetails: (user: AdminUserDto) => void;
  onUnban: (user: AdminUserDto) => void;
  onReset: (user: AdminUserDto) => void;
}) {
  if (users.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Пользователи не найдены
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Имя</TableHead>
          <TableHead>Рейтинг</TableHead>
          <TableHead>Поездок</TableHead>
          <TableHead>Отзывов</TableHead>
          <TableHead>Telegram</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Создан</TableHead>
          <TableHead>Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            onBan={onBan}
            onDetails={onDetails}
            onUnban={onUnban}
            onReset={onReset}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function UserRow({
  user,
  onBan,
  onDetails,
  onUnban,
  onReset,
}: {
  user: AdminUserDto;
  onBan: (user: AdminUserDto) => void;
  onDetails: (user: AdminUserDto) => void;
  onUnban: (user: AdminUserDto) => void;
  onReset: (user: AdminUserDto) => void;
}) {
  const isBanned = Boolean(user.bannedAt);
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <img
            src={user.avatar}
            alt=""
            className="size-8 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <span className="font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {user.phone ?? "Телефон не указан"}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>{user.rating.toFixed(1)}</TableCell>
      <TableCell>{user.tripsCount}</TableCell>
      <TableCell>{user.reviewsCount}</TableCell>
      <TableCell>
        <UserTelegramCell user={user} />
      </TableCell>
      <TableCell>
        <UserStatusCell user={user} isBanned={isBanned} />
      </TableCell>
      <TableCell>{formatDate(user.createdAt)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onDetails(user)}>
            Детали
          </Button>
          {isBanned ? (
            <Button size="sm" variant="outline" onClick={() => onUnban(user)}>
              Разбанить
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onBan(user)}
            >
              Забанить
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onReset(user)}>
            Сбросить онбординг
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function UserTelegramCell({ user }: { user: AdminUserDto }) {
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={user.telegramConnected ? "secondary" : "outline"}>
        {user.telegramConnected ? "Подключён" : "Нет"}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {user.consentAcceptedAt
          ? `Согласие: ${formatDate(user.consentAcceptedAt)}`
          : "Согласие не получено"}
      </span>
    </div>
  );
}

function UserStatusCell({
  user,
  isBanned,
}: {
  user: AdminUserDto;
  isBanned: boolean;
}) {
  if (!isBanned) {
    return <Badge variant="secondary">Активен</Badge>;
  }
  const reason = user.banReason ?? NO_REASON_LABEL;
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="destructive">Заблокирован</Badge>
      <span
        className={cn(
          "text-xs italic",
          user.banReason ? "text-muted-foreground" : "text-destructive"
        )}
        title={reason}
      >
        {reason}
      </span>
    </div>
  );
}

function UsersTableSkeleton() {
  return (
    <div aria-label="Загрузка пользователей" className="grid gap-3 py-2" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function UsersError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Не удалось загрузить пользователей</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = countPages(total, pageSize);
  return (
    <nav className="flex items-center justify-end gap-2" aria-label="Навигация по страницам пользователей">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Назад
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        стр. {page} из {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Вперёд
      </Button>
    </nav>
  );
}

function BanReasonField({
  value,
  disabled,
  touched,
  error,
  onChange,
  onBlur,
}: {
  value: string;
  disabled: boolean;
  touched: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const showError = touched && error !== null;
  return (
    <div className="grid gap-2">
      <Label htmlFor="ban-reason">Причина</Label>
      <Textarea
        id="ban-reason"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        required
        minLength={BAN_REASON_MIN}
        maxLength={BAN_REASON_MAX}
        rows={4}
        aria-invalid={showError}
        aria-describedby="ban-reason-hint"
        placeholder="Нарушение правил сервиса"
      />
      <div
        id="ban-reason-hint"
        className={cn(
          "flex items-center justify-between text-xs",
          showError ? "text-destructive" : "text-muted-foreground"
        )}
      >
        <span role={showError ? "alert" : undefined}>
          {showError ? error : `От 1 до ${BAN_REASON_MAX} символов`}
        </span>
        <span aria-label="Количество символов">
          {value.length}/{BAN_REASON_MAX}
        </span>
      </div>
    </div>
  );
}

function BanDialog({
  user,
  isPending,
  onCancel,
  onConfirm,
}: {
  user: AdminUserDto | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  // Сбрасываем состояние при закрытии — фазой рендера (setState в эффекте
  // запрещён react-hooks/set-state-in-effect). Условие 1:1 с эффектом.
  const [prevUser, setPrevUser] = useState(user);
  if (user !== prevUser) {
    setPrevUser(user);
    if (user === null) {
      setReason("");
      setTouched(false);
    }
  }

  const trimmed = reason.trim();
  const error = useMemo(() => validateBanReason(reason), [reason]);
  const submitDisabled = isPending || trimmed.length < BAN_REASON_MIN;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (error !== null) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Бан пользователя</DialogTitle>
          <DialogDescription>
            {user
              ? `${user.name} будет заблокирован и потеряет доступ к сервису. Укажите причину — она будет показана пользователю.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <BanReasonField
            value={reason}
            disabled={isPending}
            touched={touched}
            error={error}
            onChange={setReason}
            onBlur={() => setTouched(true)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onCancel}
            >
              Отмена
            </Button>
            <Button type="submit" variant="destructive" disabled={submitDisabled}>
              Забанить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnbanDialog({
  user,
  isPending,
  onCancel,
  onConfirm,
}: {
  user: AdminUserDto | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Разблокировать пользователя?</DialogTitle>
          <DialogDescription>
            {user
              ? `${user.name} будет разблокирован и снова получит доступ к сервису.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={onCancel}>
            Отмена
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            Разблокировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetOnboardingDialog({
  user,
  isPending,
  onCancel,
  onConfirm,
}: {
  user: AdminUserDto | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Сбросить онбординг?</DialogTitle>
          <DialogDescription>
            {user
              ? `${user.name} снова увидит онбординг при следующем входе в мини-приложение.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={onCancel}>
            Отмена
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            Сбросить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
