import { memo, useState } from "react";
import { Caption, Input, Text } from "@telegram-apps/telegram-ui";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { QueryState } from "@/components/QueryState";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { BTN_ROW, BTN_ROW_WRAP, MIN_TARGET, TRUNCATE } from "@/ui/classes";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { Stack } from "@/ui/Stack";
import {
  useCancelRideRequestMutation,
  useRideRequestsQuery,
  useRideRequestStatusMutation,
  useUpdateRideRequestMutation,
} from "@/queries/useRideRequestsQuery";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { haptic } from "@/utils/haptics";
import { formatMoscowDateTime, toLocalDateTimeInputValue } from "@/utils/date";
import { plural } from "@/utils/plural";
import {
  updateRideRequestDtoSchema,
  type RideRequest,
  type RideRequestStatus,
} from "@edem/contracts";
import {
  rideRequestErrorMessage,
  type RideRequestFieldError,
} from "./rideRequestValidation";
import styles from "./TripModals.module.css";

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

/**
 * Список своих заявок на попутку — тело страницы «История запросов»
 * (`/profile/ride-requests`).
 *
 * Вынесен из бывшей шторки «Ищу попутку», где список делил тело с формой
 * создания: управлять заявкой (пауза, возобновление, inline-редактирование,
 * отмена) — работа со страницей, форме создания достаточно окна.
 * Разметка и поведение — без изменений.
 *
 * `useClosingConfirmation` едет вместе со списком, а не остаётся в общем
 * теле: подтверждать закрытие нужно при незавершённом inline-редактировании
 * заявки, то есть ровно пока открыт этот список.
 */
export const RideRequestsList = memo(function RideRequestsList() {
  const requests = useRideRequestsQuery();
  const update = useUpdateRideRequestMutation();
  const status = useRideRequestStatusMutation();
  const cancel = useCancelRideRequestMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEarliest, setEditEarliest] = useState("");
  const [editLatest, setEditLatest] = useState("");
  const [editExpires, setEditExpires] = useState("");
  const [editSeats, setEditSeats] = useState("1");
  const [editError, setEditError] = useState<RideRequestFieldError | null>(
    null,
  );
  const editMessage = editError?.message ?? null;
  const editErrorFor = (id: string) =>
    editError?.field === id ? editError.message : undefined;
  const setEditMessage = (message: string) =>
    setEditError({ field: null, message });

  // Несохранённое inline-редактирование — Telegram спросит подтверждение
  // закрытия приложения (app-close; route-Back хук не ловит).
  useClosingConfirmation(editingId !== null);

  const startEdit = (request: RideRequest) => {
    setEditingId(request.id);
    setEditError(null);
    // datetime-local ждёт локальное время: общий хелпер date.ts, не
    // локальная копия форматирования (московское смещение уезжало на 3 часа).
    setEditEarliest(toDateTimeLocal(request.earliestAt));
    setEditLatest(toDateTimeLocal(request.latestAt));
    setEditExpires(
      request.expiresAt ? toDateTimeLocal(request.expiresAt) : "",
    );
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
    <>
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
                  <Field
                    label="Места"
                    id={`ride-edit-seats-${request.id}`}
                    error={editErrorFor(`ride-edit-seats-${request.id}`)}
                  >
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
    </>
  );
});

/**
 * Дата ISO → значение для `<input type="datetime-local">`.
 * Мусорный вход даёт пустую строку (поле покажет пустое, а не «Invalid Date»).
 */
function toDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return toLocalDateTimeInputValue(date);
}