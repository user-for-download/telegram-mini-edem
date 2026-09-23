import { memo } from "react";
import { useState } from "react";
import {
  Button,
  Caption,
  Input,
  Modal,
  Text,
} from "@telegram-apps/telegram-ui";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { Calendar, MapPin, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { QueryState } from "@/components/QueryState";
import { haptic } from "@/utils/haptics";
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import { ConfirmAction } from "@/components/ConfirmAction";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SearchPage } from "@/pages/Search/SearchPage";
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
import { SheetBody } from "@/ui/SheetBody";
import { Stack } from "@/ui/Stack";
import styles from "./TripModals.module.css";

function toDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Запросы «Ищу попутку» — route-backed шторка поверх «Поиска»;
 * роут /ride-requests остаётся источником правды ради точки
 * входа SearchPage:108 — тот же href `#/ride-requests`).
 *
 * Закрытие: native Back — через Shell.handleBack (стек handleModalBack
 * пуст для route-модалок → navigate(-1)), прямой вход — fallback на
 * /trips. PageHeader с back-кнопкой внутри убран — закрытие через
 * header шторки. a11y: нативный telegram-ui Modal (vaul Drawer поверх
 * Radix Dialog) даёт role=dialog + aria-modal, Esc/overlay-закрытие через
 * onOpenChange, focus-trap и возврат фокуса; таргеты ≥44px (min-h),
 * ошибки — role=alert.
 */
export function RideRequestsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Фокус, Esc и Tab-trap — нативные (Radix FocusScope + onOpenChange);
  // свой role=dialog не добавляем — vaul уже рендерит dialog (двойной анонс).
  // Имя диалога + видимый заголовок на base: tgui Modal.Header рисует
  // текст только на iOS.
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Ищу попутку</Modal.Header>}
      aria-labelledby={titleId}
    >
      <SheetBody>
        <SheetTitle titleId={titleId}>Ищу попутку</SheetTitle>
        <RideRequestsBody />
      </SheetBody>
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
 * Тело «Ищу попутку» без PageHeader (создание, inline-редактирование
 * PATCH, пауза/возобновление, отмена
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

  // Несохранённое inline-редактирование — Telegram спросит подтверждение
  // закрытия приложения (app-close; route-Back модалки хук не ловит).
  useClosingConfirmation(editingId !== null);

  const submit = () => {
    const fromCity = cities.data?.find((city) => city.name === from);
    const toCity = cities.data?.find((city) => city.name === to);
    const earliestDate = new Date(earliest);
    const latestDate = new Date(latest);
    if (
      !fromCity ||
      !toCity ||
      !Number.isFinite(earliestDate.getTime()) ||
      !Number.isFinite(latestDate.getTime())
    ) {
      setValidationError("Выберите города и временной интервал");
      return;
    }
    if (fromCity.id === toCity.id) {
      setValidationError("Города отправления и прибытия должны различаться");
      return;
    }
    const parsed = createRideRequestDtoSchema.safeParse({
      fromCityId: fromCity.id,
      toCityId: toCity.id,
      earliestAt: earliestDate.toISOString(),
      latestAt: latestDate.toISOString(),
      expiresAt: earliestDate.toISOString(),
      seats: Number(seats),
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? "Проверьте параметры запроса",
      );
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
      setEditError(
        "Срок действия должен быть в будущем, а окно отправления — корректным",
      );
      return;
    }
    const parsed = updateRideRequestDtoSchema.safeParse({
      earliestAt: earliestDate.toISOString(),
      latestAt: latestDate.toISOString(),
      expiresAt: expiresDate.toISOString(),
      seats: Number(editSeats),
    });
    if (!parsed.success) {
      setEditError(
        parsed.error.issues[0]?.message ?? "Проверьте параметры запроса",
      );
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
      <Stack className={styles.stackBottom}>
        <div className={styles.card}>
          <Text weight="2" Component="span">
            Новый запрос
          </Text>
          <div>
            <label htmlFor="ride-from" className="sr-only">
              Откуда
            </label>
            <Input
              id="ride-from"
              header="Откуда"
              before={<MapPin size={17} className={styles.iconInfo} />}
              list="request-cities"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="Город отправления"
            />
          </div>
          <div>
            <label htmlFor="ride-to" className="sr-only">
              Куда
            </label>
            <Input
              id="ride-to"
              header="Куда"
              before={<MapPin size={17} className={styles.iconSuccess} />}
              list="request-cities"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="Город назначения"
            />
          </div>
          <datalist id="request-cities">
            {cities.data?.map((city) => (
              <option key={city.id} value={city.name} />
            ))}
          </datalist>
          <div className={styles.grid2}>
            <div>
              <label htmlFor="ride-earliest" className="sr-only">
                Не раньше
              </label>
              <Input
                id="ride-earliest"
                header="Не раньше"
                before={
                  <Calendar size={16} className={styles.iconHint} />
                }
                type="datetime-local"
                value={earliest}
                onChange={(event) => setEarliest(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ride-latest" className="sr-only">
                Не позже
              </label>
              <Input
                id="ride-latest"
                header="Не позже"
                before={
                  <Calendar size={16} className={styles.iconHint} />
                }
                type="datetime-local"
                value={latest}
                onChange={(event) => setLatest(event.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="ride-seats" className="sr-only">
              Места
            </label>
            <Input
              id="ride-seats"
              header="Места"
              before={<Users size={16} className={styles.iconHint} />}
              type="number"
              min="1"
              max="3"
              value={seats}
              onChange={(event) => setSeats(event.target.value)}
            />
          </div>
          {validationError && (
            <Caption
              Component="p"
              role="alert"
              className={styles.errorText}
            >
              {validationError}
            </Caption>
          )}
          {create.error && (
            <Caption
              Component="p"
              role="alert"
              className={styles.errorText}
            >
              {bookingErrorMessage(create.error)}
            </Caption>
          )}
          <Button
            mode="bezeled"
            stretched
            size="l"
            className="min-h-11"
            loading={create.isPending}
            onClick={submit}
          >
            Опубликовать запрос
          </Button>
        </div>
        {(status.error || cancel.error || update.error) && (
          <Caption
            Component="p"
            role="alert"
            className={styles.errorText}
          >
            {bookingErrorMessage(status.error ?? cancel.error ?? update.error)}
          </Caption>
        )}
        <QueryState
          loading={requests.isLoading}
          error={requests.error}
          empty={!requests.data?.length}
          emptyText="Активных запросов нет."
          onRetry={() => void requests.refetch()}
        >
          <Stack>
            {requests.data?.map((request) => (
              <div
                key={request.id}
                className={styles.card}
              >
                <div className={styles.cardHead}>
                  <Text weight="2" Component="span" className={styles.truncate}>
                    {`${request.fromCity.name} → ${request.toCity.name}`}
                  </Text>
                  <StatusPill
                    tone={request.status === "active" ? "success" : "warning"}
                  >
                    {request.status === "active" ? "Активен" : request.status}
                  </StatusPill>
                </div>
                <Caption Component="div">
                  {`${request.earliestAt} — ${request.latestAt} · ${request.seats} мест`}
                </Caption>
                {editingId === request.id ? (
                  <>
                    <div>
                      <label
                        htmlFor={`ride-edit-earliest-${request.id}`}
                        className="sr-only"
                      >
                        Не раньше
                      </label>
                      <Input
                        id={`ride-edit-earliest-${request.id}`}
                        header="Не раньше"
                        type="datetime-local"
                        value={editEarliest}
                        onChange={(event) =>
                          setEditEarliest(event.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`ride-edit-latest-${request.id}`}
                        className="sr-only"
                      >
                        Не позже
                      </label>
                      <Input
                        id={`ride-edit-latest-${request.id}`}
                        header="Не позже"
                        type="datetime-local"
                        value={editLatest}
                        onChange={(event) => setEditLatest(event.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`ride-edit-expires-${request.id}`}
                        className="sr-only"
                      >
                        Действует до
                      </label>
                      <Input
                        id={`ride-edit-expires-${request.id}`}
                        header="Действует до"
                        type="datetime-local"
                        value={editExpires}
                        onChange={(event) => setEditExpires(event.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`ride-edit-seats-${request.id}`}
                        className="sr-only"
                      >
                        Места
                      </label>
                      <Input
                        id={`ride-edit-seats-${request.id}`}
                        header="Места"
                        type="number"
                        min="1"
                        max="3"
                        value={editSeats}
                        onChange={(event) => setEditSeats(event.target.value)}
                      />
                    </div>
                    {editError && (
                      <Caption
                        Component="p"
                        role="alert"
                        className={styles.errorText}
                      >
                        {editError}
                      </Caption>
                    )}
                    <div className={styles.btnRow}>
                      <Button
                        mode="bezeled"
                        stretched
                        size="s"
                        className="min-h-11"
                        loading={update.isPending}
                        onClick={() => submitEdit(request.id)}
                      >
                        Сохранить
                      </Button>
                      <Button
                        mode="bezeled"
                        size="s"
                        stretched
                        className="min-h-11"
                        disabled={update.isPending}
                        onClick={() => setEditingId(null)}
                      >
                        Отмена
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className={styles.btnRowWrap}>
                    {request.status === "active" && (
                      <Button
                        mode="bezeled"
                        size="s"
                        stretched
                        className="min-h-11"
                        loading={
                          status.isPending &&
                          status.variables?.id === request.id
                        }
                        disabled={status.isPending || cancel.isPending}
                        onClick={() =>
                          status.mutate({ id: request.id, status: "paused" })
                        }
                      >
                        Поставить на паузу
                      </Button>
                    )}
                    {request.status === "paused" && (
                      <Button
                        mode="bezeled"
                        size="s"
                        stretched
                        className="min-h-11"
                        loading={
                          status.isPending &&
                          status.variables?.id === request.id
                        }
                        disabled={status.isPending || cancel.isPending}
                        onClick={() =>
                          status.mutate({ id: request.id, status: "active" })
                        }
                      >
                        Возобновить
                      </Button>
                    )}
                    {(request.status === "active" ||
                      request.status === "paused") && (
                      <>
                        <Button
                          mode="bezeled"
                          size="s"
                          stretched
                          className="min-h-11"
                          disabled={status.isPending || cancel.isPending}
                          onClick={() => startEdit(request)}
                        >
                          Редактировать
                        </Button>
                        <span className={styles.contentsBtn}>
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
          </Stack>
        </QueryState>
      </Stack>
    </section>
  );
});
