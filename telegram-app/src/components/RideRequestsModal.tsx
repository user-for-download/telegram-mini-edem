import {
  memo,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useState } from "react";
import { Button, Input, Modal } from "@telegram-apps/telegram-ui";
import { Calendar, MapPin, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { QueryState } from "@/components/QueryState";
import { haptic } from "@/utils/haptics";
import { ConfirmAction } from "@/components/ConfirmAction";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SearchPage } from "@/pages/SearchPage";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import {
  useCancelRideRequestMutation,
  useCreateRideRequestMutation,
  useRideRequestStatusMutation,
  useRideRequestsQuery,
  useUpdateRideRequestMutation,
} from "@/queries/useRideRequestsQuery";
import {
  createRideRequestDtoSchema,
  updateRideRequestDtoSchema,
  type RideRequest,
} from "@edem/contracts";

function toDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Запросы «Ищу попутку» — route-backed модалка поверх «Поиска» (модель
 * CreateTripModal/ReviewsModal: в Telegram нет «новых страниц», только
 * модалки; роут /ride-requests остаётся источником правды ради точки
 * входа SearchPage:108 — тот же href `#/ride-requests`).
 *
 * Закрытие: native Back — через Shell.handleBack (стек handleModalBack
 * пуст для route-модалок → navigate(-1)), прямой вход — fallback на
 * /trips. PageHeader с back-кнопкой внутри убран — закрытие через
 * header шторки. a11y: role=dialog + aria-modal, Esc, focus-trap,
 * таргеты ≥44px (min-h), ошибки — role=alert.
 */
export function RideRequestsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc закрывает шторку (a11y); native Back обрабатывает Shell.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Фокус внутрь диалога при открытии (Modal держит портал).
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Лёгкий focus-trap: Tab циклится внутри диалога.
  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = [
      ...root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Ищу попутку</Modal.Header>}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ищу попутку"
        tabIndex={-1}
        onKeyDown={trapTab}
        className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto outline-none"
      >
        <RideRequestsBody />
      </div>
    </Modal>
  );
}

/**
 * Роут /ride-requests: фон — «Поиск» (точка входа SearchPage:108),
 * поверх — шторка запросов. Закрытие — назад по истории, иначе
 * fallback на /trips. Путь не меняется.
 */
export function RideRequestsRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/trips", { replace: true });
  };
  return (
    <>
      <SearchPage />
      <RideRequestsModal open onClose={close} />
    </>
  );
}

/**
 * Тело «Ищу попутку» без PageHeader (паритет VK RideRequestsPanel:
 * создание, inline-редактирование PATCH, пауза/возобновление, отмена
 * через confirm-guard, retry/offline). Экспортировано для SSR-тестов:
 * Modal — портал, в renderToString не попадает. Мемоизировано.
 */
export const RideRequestsBody = memo(function RideRequestsBody() {
  const requests = useRideRequestsQuery();
  const cities = useAllCitiesQuery();
  const create = useCreateRideRequestMutation();
  const update = useUpdateRideRequestMutation();
  const status = useRideRequestStatusMutation();
  const cancel = useCancelRideRequestMutation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [earliest, setEarliest] = useState("");
  const [latest, setLatest] = useState("");
  const [seats, setSeats] = useState("1");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEarliest, setEditEarliest] = useState("");
  const [editLatest, setEditLatest] = useState("");
  const [editExpires, setEditExpires] = useState("");
  const [editSeats, setEditSeats] = useState("1");
  const [editError, setEditError] = useState<string | null>(null);

  const submit = () => {
    const fromCity = cities.data?.find((city) => city.name === from);
    const toCity = cities.data?.find((city) => city.name === to);
    const earliestDate = new Date(earliest);
    const latestDate = new Date(latest);
    if (!fromCity || !toCity || !Number.isFinite(earliestDate.getTime()) || !Number.isFinite(latestDate.getTime())) {
      setValidationError("Выберите города и временной интервал");
      return;
    }
    if (fromCity.id === toCity.id) {
      setValidationError("Города отправления и прибытия должны различаться");
      return;
    }
    const parsed = createRideRequestDtoSchema.safeParse({ fromCityId: fromCity.id, toCityId: toCity.id, earliestAt: earliestDate.toISOString(), latestAt: latestDate.toISOString(), expiresAt: earliestDate.toISOString(), seats: Number(seats) });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Проверьте параметры запроса");
      return;
    }
    setValidationError(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        haptic.success();
        setFrom("");
        setTo("");
        setEarliest("");
        setLatest("");
      },
      onError: () => haptic.error(),
    });
  };

  const startEdit = (request: RideRequest) => {
    setEditingId(request.id);
    setEditError(null);
    setEditEarliest(toDateTimeLocal(request.earliestAt));
    setEditLatest(toDateTimeLocal(request.latestAt));
    setEditExpires(request.expiresAt ? toDateTimeLocal(request.expiresAt) : "");
    setEditSeats(String(request.seats));
  };

  const submitEdit = (requestId: string) => {
    setEditError(null);
    const earliestDate = new Date(editEarliest);
    const latestDate = new Date(editLatest);
    const expiresDate = new Date(editExpires);
    if (
      !Number.isFinite(earliestDate.getTime()) ||
      !Number.isFinite(latestDate.getTime()) ||
      !Number.isFinite(expiresDate.getTime()) ||
      earliestDate >= latestDate ||
      expiresDate <= new Date()
    ) {
      setEditError("Срок действия должен быть в будущем, а окно отправления — корректным");
      return;
    }
    const parsed = updateRideRequestDtoSchema.safeParse({
      earliestAt: earliestDate.toISOString(),
      latestAt: latestDate.toISOString(),
      expiresAt: expiresDate.toISOString(),
      seats: Number(editSeats),
    });
    if (!parsed.success) {
      setEditError(parsed.error.issues[0]?.message ?? "Проверьте параметры запроса");
      return;
    }
    update.mutate(
      { id: requestId, data: parsed.data },
      {
        onSuccess: () => {
          haptic.success();
          setEditingId(null);
        },
        onError: () => haptic.error(),
      },
    );
  };

  return (
    <section aria-label="Ищу попутку">
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 pt-1 pb-6">
      <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-[var(--tgui--text_color)]">
          Новый запрос
        </span>
        <div className="FormField">
          <label htmlFor="ride-from">Откуда</label>
          <Input
            id="ride-from"
            before={<MapPin size={17} className="text-[var(--app-info)]" />}
            list="request-cities"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder="Город отправления"
          />
        </div>
        <div className="FormField">
          <label htmlFor="ride-to">Куда</label>
          <Input
            id="ride-to"
            before={<MapPin size={17} className="text-[var(--app-success)]" />}
            list="request-cities"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="Город назначения"
          />
        </div>
        <datalist id="request-cities">{cities.data?.map((city) => <option key={city.id} value={city.name} />)}</datalist>
        <div className="grid grid-cols-2 gap-3">
          <div className="FormField">
            <label htmlFor="ride-earliest">Не раньше</label>
            <Input
              id="ride-earliest"
              before={<Calendar size={16} className="text-[var(--tgui--hint_color)]" />}
              type="datetime-local"
              value={earliest}
              onChange={(event) => setEarliest(event.target.value)}
            />
          </div>
          <div className="FormField">
            <label htmlFor="ride-latest">Не позже</label>
            <Input
              id="ride-latest"
              before={<Calendar size={16} className="text-[var(--tgui--hint_color)]" />}
              type="datetime-local"
              value={latest}
              onChange={(event) => setLatest(event.target.value)}
            />
          </div>
        </div>
        <div className="FormField">
          <label htmlFor="ride-seats">Места</label>
          <Input
            id="ride-seats"
            before={<Users size={16} className="text-[var(--tgui--hint_color)]" />}
            type="number"
            min="1"
            max="3"
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />
        </div>
        {validationError && <p className="FormError" role="alert">{validationError}</p>}
        {create.error && <p className="FormError" role="alert">{bookingErrorMessage(create.error)}</p>}
        <Button stretched size="l" className="min-h-[44px]" loading={create.isPending} onClick={submit}>Опубликовать запрос</Button>
      </div>
      {(status.error || cancel.error || update.error) && (
        <p className="FormError" role="alert">
          {bookingErrorMessage(status.error ?? cancel.error ?? update.error)}
        </p>
      )}
      <QueryState loading={requests.isLoading} error={requests.error} empty={!requests.data?.length} emptyText="Активных запросов нет." onRetry={() => void requests.refetch()}>
        <div className="flex flex-col gap-3">
          {requests.data?.map((request) => (
            <div
              key={request.id}
              className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-bold text-[var(--tgui--text_color)] truncate">
                  {`${request.fromCity.name} → ${request.toCity.name}`}
                </span>
                <span
                  className="StatusPill"
                  data-tone={request.status === "active" ? "success" : "warning"}
                >
                  {request.status === "active" ? "Активен" : request.status}
                </span>
              </div>
              <div className="text-[13px] text-[var(--tgui--hint_color)]">
                {`${request.earliestAt} — ${request.latestAt} · ${request.seats} мест`}
              </div>
              {editingId === request.id ? (
                <>
                  <div className="FormField">
                    <label htmlFor={`ride-edit-earliest-${request.id}`}>Не раньше</label>
                    <Input
                      id={`ride-edit-earliest-${request.id}`}
                      type="datetime-local"
                      value={editEarliest}
                      onChange={(event) => setEditEarliest(event.target.value)}
                    />
                  </div>
                  <div className="FormField">
                    <label htmlFor={`ride-edit-latest-${request.id}`}>Не позже</label>
                    <Input
                      id={`ride-edit-latest-${request.id}`}
                      type="datetime-local"
                      value={editLatest}
                      onChange={(event) => setEditLatest(event.target.value)}
                    />
                  </div>
                  <div className="FormField">
                    <label htmlFor={`ride-edit-expires-${request.id}`}>Действует до</label>
                    <Input
                      id={`ride-edit-expires-${request.id}`}
                      type="datetime-local"
                      value={editExpires}
                      onChange={(event) => setEditExpires(event.target.value)}
                    />
                  </div>
                  <div className="FormField">
                    <label htmlFor={`ride-edit-seats-${request.id}`}>Места</label>
                    <Input
                      id={`ride-edit-seats-${request.id}`}
                      type="number"
                      min="1"
                      max="3"
                      value={editSeats}
                      onChange={(event) => setEditSeats(event.target.value)}
                    />
                  </div>
                  {editError && <p className="FormError" role="alert">{editError}</p>}
                  <div className="flex gap-2">
                    <Button stretched size="s" className="min-h-[44px]" loading={update.isPending} onClick={() => submitEdit(request.id)}>Сохранить</Button>
                    <Button mode="bezeled" size="s" stretched className="min-h-[44px]" disabled={update.isPending} onClick={() => setEditingId(null)}>Отмена</Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {request.status === "active" && (
                    <Button mode="bezeled" size="s" stretched className="min-h-[44px]" loading={status.isPending && status.variables?.id === request.id} disabled={status.isPending || cancel.isPending} onClick={() => status.mutate({ id: request.id, status: "paused" })}>
                      Поставить на паузу
                    </Button>
                  )}
                  {request.status === "paused" && (
                    <Button mode="bezeled" size="s" stretched className="min-h-[44px]" loading={status.isPending && status.variables?.id === request.id} disabled={status.isPending || cancel.isPending} onClick={() => status.mutate({ id: request.id, status: "active" })}>
                      Возобновить
                    </Button>
                  )}
                  {(request.status === "active" || request.status === "paused") && (
                    <>
                      <Button mode="bezeled" size="s" stretched className="min-h-[44px]" disabled={status.isPending || cancel.isPending} onClick={() => startEdit(request)}>
                        Редактировать
                      </Button>
                      <span className="[&_button]:min-h-[44px] contents">
                        <ConfirmAction
                          label="Отменить запрос"
                          confirmLabel="Отменить запрос"
                          description="Запрос будет снят с публикации."
                          pending={cancel.isPending}
                          onConfirm={() => cancel.mutate(request.id)}
                        />
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </QueryState>
      </div>
    </section>
  );
});
