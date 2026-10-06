import { memo } from "react";
import { useState } from "react";
import { Caption, Input, Text } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { BTN_ROW, BTN_ROW_WRAP, HINT, MIN_TARGET, TRUNCATE } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";

import { StatusPill } from "@/components/StatusPill/StatusPill";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";
import { Calendar, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { QueryState } from "@/components/QueryState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { haptic } from "@/utils/haptics";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SearchPage } from "@/pages/Search/SearchPage";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { plural } from "@/utils/plural";
import type { RideRequestStatus } from "@edem/contracts";

/**
 * Статус запроса попутчика: подпись и тон.
 * Все статусы — русскими словами: сырое перечисление бэкенда
 * («paused», «fulfilled», «expired») пользователю не показываем.
 * Терминальные статусы бэкенд не меняет: редактирование доступно только
 * у active/paused, но показать их всё равно нужно.
 */
const RIDE_REQUEST_STATUS_LABELS: Readonly<Record<RideRequestStatus, string>> =
  {
    active: "Активен",
    paused: "На паузе",
    fulfilled: "Выполнен",
    expired: "Истёк",
    cancelled: "Отменён",
  };

const RIDE_REQUEST_STATUS_TONES: Readonly<
  Record<RideRequestStatus, "warning" | "danger" | "info" | "success">
> = {
  active: "success",
  paused: "warning",
  fulfilled: "info",
  expired: "info",
  cancelled: "danger",
};
import { formatMoscowDateTime } from "@/utils/date";
import {
  rideRequestErrorMessage,
  validateRideRequestWindow,
  type RideRequestFieldError,
} from "./rideRequestValidation";
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
import { Card } from "@/ui/Card";
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
 * роут /ride-requests остаётся источником правды ради точки входа
 * с главной: `navigate("/ride-requests")` из CTA «Ищу попутку» (HomePage).
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
  return (
    <Sheet open={open} onClose={onClose} title="Ищу попутку">
      <RideRequestsBody />
    </Sheet>
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
  // Города — id справочника: имя резолвится в id только при отправке —
  // тот же антипаттерн давал ложную ошибку «Выберите города из справочника».
  const [fromCityId, setFromCityId] = useState("");
  const [toCityId, setToCityId] = useState("");
  const [earliest, setEarliest] = useState("");
  const [latest, setLatest] = useState("");
  const [seats, setSeats] = useState("1");
  // Ошибка приходит с полем: <Field error=…> ставит aria-invalid и
  // aria-describedby. Zod-сообщения переводятся rideRequestErrorMessage.
  const [createError, setCreateError] = useState<RideRequestFieldError | null>(null);
  const validationError = createError?.message ?? null;
  const createErrorFor = (id: string) =>
    createError?.field === id ? createError.message : undefined;
  const setValidationError = (message: string) =>
    setCreateError({ field: null, message });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEarliest, setEditEarliest] = useState("");
  const [editLatest, setEditLatest] = useState("");
  const [editExpires, setEditExpires] = useState("");
  const [editSeats, setEditSeats] = useState("1");
  const [editError, setEditError] = useState<RideRequestFieldError | null>(null);
  const editMessage = editError?.message ?? null;
  const editErrorFor = (id: string) =>
    editError?.field === id ? editError.message : undefined;
  const setEditMessage = (message: string) =>
    setEditError({ field: null, message });

  // Несохранённое inline-редактирование — Telegram спросит подтверждение
  // закрытия приложения (app-close; route-Back модалки хук не ловит).
  useClosingConfirmation(editingId !== null);

  const submit = () => {
    const fromCity = cities.data?.find((city) => city.id === fromCityId);
    const toCity = cities.data?.find((city) => city.id === toCityId);
    if (!fromCity || !toCity) {
      setValidationError("Выберите города из справочника");
      return;
    }
    // Порядок окна — до схемы: zod отвечает английским message,
    // пользователю показываем русский текст.
    const windowError = validateRideRequestWindow(earliest, latest);
    if (windowError) {
      setValidationError(windowError);
      return;
    }
    const earliestDate = new Date(earliest);
    const latestDate = new Date(latest);
    if (fromCity.id === toCity.id) {
      setValidationError("Города отправления и прибытия должны различаться");
      return;
    }
    const parsed = createRideRequestDtoSchema.safeParse({
      fromCityId: fromCity.id,
      toCityId: toCity.id,
      earliestAt: earliestDate.toISOString(),
      latestAt: latestDate.toISOString(),
      // Запрос живёт до конца окна «Не позже»: привязка к earliest
      // гасила его из выдачи в момент начала окна.
      expiresAt: latestDate.toISOString(),
      seats: Number(seats),
    });
    if (!parsed.success) {
      setCreateError(
        rideRequestErrorMessage(parsed.error.issues[0]?.path ?? []),
      );
      return;
    }
    setCreateError(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        haptic.success();
        setFromCityId("");
        setToCityId("");
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
      setEditMessage(
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
        rideRequestErrorMessage(
          parsed.error.issues[0]?.path ?? [],
          requestId ?? undefined,
        ),
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
        <Card className={styles.card}>
          <Text weight="2" Component="span">
            Новый запрос
          </Text>
          {/* Выбор города — тот же CitySelectField, что на главной, в поиске и
              форме создания. */}
          <CitySelectField
            id="ride-from"
            label="Откуда"
            valueId={fromCityId}
            cities={cities.data}
            placeholder="Город отправления"
            excludeId={toCityId}
            onChange={setFromCityId}
            error={createErrorFor("ride-from")}
          />
          <CitySelectField
            id="ride-to"
            label="Куда"
            valueId={toCityId}
            cities={cities.data}
            placeholder="Город назначения"
            excludeId={fromCityId}
            onChange={setToCityId}
            error={createErrorFor("ride-to")}
          />
          <div className={styles.grid2}>
            <Field label="Не раньше" id="ride-earliest" error={createErrorFor("ride-earliest")}>
              {(field) => (
                <Input
                  {...field}
                  before={<Calendar size={16} className={HINT} />}
                  type="datetime-local"
                  value={earliest}
                  onChange={(event) => setEarliest(event.target.value)}
                />
              )}
            </Field>
            <Field label="Не позже" id="ride-latest" error={createErrorFor("ride-latest")}>
              {(field) => (
                <Input
                  {...field}
                  before={<Calendar size={16} className={HINT} />}
                  type="datetime-local"
                  value={latest}
                  onChange={(event) => setLatest(event.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Места" id="ride-seats" error={createErrorFor("ride-seats")}>
            {(field) => (
              <Input
                {...field}
                before={<Users size={16} className={HINT} />}
                type="number"
                min="1"
                max="3"
                value={seats}
                onChange={(event) => setSeats(event.target.value)}
              />
            )}
          </Field>
          {/* Плашка только когда поле null: иначе текст уже нарисован
              самим <Field> и второй раз дублировался бы. */}
          {validationError && !createError?.field && (
            <Notice tone="danger" variant="text">
              {validationError}
            </Notice>
          )}
          {create.error && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(create.error)}
            </Notice>
          )}
          <Button
            stretched
            size="l"
            loading={create.isPending}
            onClick={submit}
          >
            Опубликовать запрос
          </Button>
        </Card>
        {(status.error || cancel.error || update.error) && (
          <Notice tone="danger" variant="text">
            {bookingErrorMessage(status.error ?? cancel.error ?? update.error)}
          </Notice>
        )}
        <QueryState
          loading={requests.isLoading}
          error={requests.error}
          empty={!requests.data?.length}
          emptyText={EMPTY_STATES.rideRequestsEmpty.description}
          onRetry={() => void requests.refetch()}
        >
          <Stack>
            {requests.data?.map((request) => (
              <Card key={request.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <Text weight="2" Component="span" className={TRUNCATE}>
                    {`${request.fromCity.name} → ${request.toCity.name}`}
                  </Text>
                  <StatusPill tone={RIDE_REQUEST_STATUS_TONES[request.status]}>
                    {RIDE_REQUEST_STATUS_LABELS[request.status]}
                  </StatusPill>
                </div>
                <Caption Component="div">
                  {`${formatMoscowDateTime(request.earliestAt)} — ${formatMoscowDateTime(request.latestAt)} · ${request.seats} ${plural(request.seats, "место", "места", "мест")}`}
                </Caption>
                {editingId === request.id ? (
                  <>
                    <Field
                      label="Не раньше"
                      id={`ride-edit-earliest-${request.id}`}
                    >
                      {(field) => (
                        <Input
                          {...field}
                          type="datetime-local"
                          value={editEarliest}
                          onChange={(event) =>
                            setEditEarliest(event.target.value)
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label="Не позже"
                      id={`ride-edit-latest-${request.id}`}
                    >
                      {(field) => (
                        <Input
                          {...field}
                          type="datetime-local"
                          value={editLatest}
                          onChange={(event) =>
                            setEditLatest(event.target.value)
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label="Действует до"
                      id={`ride-edit-expires-${request.id}`}
                    >
                      {(field) => (
                        <Input
                          {...field}
                          type="datetime-local"
                          value={editExpires}
                          onChange={(event) =>
                            setEditExpires(event.target.value)
                          }
                        />
                      )}
                    </Field>
                    <Field label="Места" id={`ride-edit-seats-${request.id}`} error={editErrorFor(`ride-edit-seats-${request.id}`)}>
                      {(field) => (
                        <Input
                          {...field}
                          type="number"
                          min="1"
                          max="3"
                          value={editSeats}
                          onChange={(event) => setEditSeats(event.target.value)}
                        />
                      )}
                    </Field>
                    {/* Плашка нужна только когда поле null: иначе ошибка
                        рисуется самим <Field>. */}
                    {editMessage && !editError?.field && (
                      <Notice tone="danger" variant="text">
                        {editMessage}
                      </Notice>
                    )}
                    <div className={BTN_ROW}>
                      <Button
                        stretched
                        size="s"
                        className={MIN_TARGET}
                        loading={update.isPending}
                        onClick={() => submitEdit(request.id)}
                      >
                        Сохранить
                      </Button>
                      <Button
                        size="s"
                        stretched
                        className={MIN_TARGET}
                        disabled={update.isPending}
                        onClick={() => setEditingId(null)}
                      >
                        Отмена
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className={BTN_ROW_WRAP}>
                    {request.status === "active" && (
                      <Button
                        size="s"
                        stretched
                        className={MIN_TARGET}
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
                        size="s"
                        stretched
                        className={MIN_TARGET}
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
                          size="s"
                          stretched
                          className={MIN_TARGET}
                          disabled={status.isPending || cancel.isPending}
                          onClick={() => startEdit(request)}
                        >
                          Редактировать
                        </Button>
                        <span className={styles.contentsBtn}>
                          <ConfirmPopup
                            label="Отменить запрос"
                            confirmLabel="Отменить запрос"
                            description="Запрос будет снят с публикации."
                            pending={cancel.isPending}
                            destructive
                            onConfirm={() => cancel.mutate(request.id)}
                          />
                        </span>
                      </>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </Stack>
        </QueryState>
      </Stack>
    </section>
  );
});
