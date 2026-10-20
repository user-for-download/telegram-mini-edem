import { useState } from "react";
import { Caption, Input, Subheadline } from "@telegram-apps/telegram-ui";
import {
  MAX_SEATS,
  updateRideRequestDtoSchema,
  type RideRequest,
} from "@edem/contracts";

import { ConfirmPopup } from "@/components/ConfirmPopup";
import { OfflineBanner } from "@/components/OfflineBanner";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { Button } from "@/ui/Button";
import { BTN_ROW, MIN_TARGET } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { GroupLabel } from "@/ui/GroupLabel";
import { Notice } from "@/ui/Notice";
import { Sheet } from "@/ui/Sheet";
import { Stack } from "@/ui/Stack";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import {
  useCancelRideRequestMutation,
  useRideRequestStatusMutation,
  useUpdateRideRequestMutation,
} from "@/queries/useRideRequestsQuery";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { haptic } from "@/utils/haptics";
import {
  formatMoscowDateTime,
  formatMoscowDateTimeRange,
  fromMoscowDateTimeInput,
  toLocalDateTimeInputValue,
} from "@/utils/date";
import { plural } from "@/utils/plural";
import {
  rideRequestErrorMessage,
  type RideRequestFieldError,
} from "./rideRequestValidation";
import {
  RIDE_REQUEST_STATUS_LABELS,
  RIDE_REQUEST_STATUS_TONES,
  rideRequestViewStatus,
} from "./rideRequestStatus";
import styles from "./TripModals.module.css";

/**
 * Шторка управления своей заявкой на попутку — открывается тапом по строке
 * списка.
 *
 * Хост-managed (`request` + `onClose`): Back перехватывает `useModalBack`
 * списка. `request === null` = «окно закрыто».
 *
 * `retained` нужен, как и в `ReportDetailsModal`: Radix держит тело
 * смонтированным до конца exit-анимации, поэтому последнюю заявку нельзя
 * занулять вместе с пропом — шторка уезжала бы пустой.
 */
export function RideRequestDetailsModal({
  request,
  onClose,
}: {
  request: RideRequest | null;
  onClose: () => void;
}) {
  const [retained, setRetained] = useState(request);
  if (request !== null && request !== retained) setRetained(request);
  const visible = request ?? retained;

  return (
    <Sheet open={request !== null} onClose={onClose} title="Запрос на попутку">
      <OfflineBanner />
      {visible === null ? null : (
        // key по id: при переходе к другой заявке состояние правки не
        // переезжает на неё (шторка может не успеть размонтироваться).
        <RideRequestDetailsBody
          key={visible.id}
          request={visible}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

/**
 * Тело шторки без обёртки Sheet — экспортируется ради SSR-тестов: Modal кита
 * это портал, в renderToString он не попадает (приём ReportDetailsBody).
 *
 * Сверху вниз: маршрут и фактический статус → окно и места → управление.
 * Действия есть только у живой заявки; у терминальной остаётся справка.
 */
export function RideRequestDetailsBody({
  request,
  onClose,
}: {
  request: RideRequest;
  onClose: () => void;
}) {
  const update = useUpdateRideRequestMutation();
  const status = useRideRequestStatusMutation();
  const cancel = useCancelRideRequestMutation();
  const [editing, setEditing] = useState(false);
  const [editEarliest, setEditEarliest] = useState("");
  const [editLatest, setEditLatest] = useState("");
  const [editExpires, setEditExpires] = useState("");
  const [editSeats, setEditSeats] = useState("1");
  const [editError, setEditError] = useState<RideRequestFieldError | null>(
    null,
  );

  // Несохранённая правка — Telegram спросит подтверждение закрытия
  // приложения. Шторку Back/крестик закрывают без гейта: это локальное
  // действие, а не потеря уже введённого на странице.
  useClosingConfirmation(editing);

  const shownStatus = rideRequestViewStatus(request);
  const live = shownStatus === "active" || shownStatus === "paused";
  const statusLabel = RIDE_REQUEST_STATUS_LABELS[shownStatus];
  const window = formatMoscowDateTimeRange(
    request.earliestAt,
    request.latestAt,
  );
  const seats = `${request.seats} ${plural(request.seats, "место", "места", "мест")}`;
  const editMessage = editError?.message ?? null;
  const editErrorFor = (id: string) =>
    editError?.field === id ? editError.message : undefined;
  const setEditMessage = (message: string) =>
    setEditError({ field: null, message });
  const error =
    status.error ??
    update.error ??
    cancel.error;

  const startEdit = () => {
    setEditing(true);
    setEditError(null);
    // datetime-local ждёт стенное время ПО МОСКВЕ (общий хелпер date.ts,
    // пара к fromMoscowDateTimeInput в submitEdit): локальная копия
    // форматирования через геттеры даты давала зону устройства, и начало
    // окна уезжало на часы у клиента вне МСК. Битый ISO — "" (хелпер
    // возвращает пустую строку для Invalid Date).
    setEditEarliest(toLocalDateTimeInputValue(new Date(request.earliestAt)));
    setEditLatest(toLocalDateTimeInputValue(new Date(request.latestAt)));
    setEditExpires(
      request.expiresAt
        ? toLocalDateTimeInputValue(new Date(request.expiresAt))
        : "",
    );
    setEditSeats(String(request.seats));
  };

  const submitEdit = () => {
    setEditError(null);
    // Строки полей — стенное время ПО МОСКВЕ (пара к хелперу в startEdit):
    // `new Date(value)` читал бы их в зоне устройства и сдвигал окно.
    const earliestDate = fromMoscowDateTimeInput(editEarliest);
    const latestDate = fromMoscowDateTimeInput(editLatest);
    const expiresDate = fromMoscowDateTimeInput(editExpires);
    if (
      earliestDate === null ||
      latestDate === null ||
      expiresDate === null ||
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
          request.id,
        ),
      );
      return;
    }
    update.mutate(
      { id: request.id, data: parsed.data },
      {
        onSuccess: () => {
          haptic.success();
          setEditing(false);
        },
        onError: () => haptic.error(),
      },
    );
  };

  return (
    <Stack>
      <div className={styles.detailsHead}>
        <Subheadline weight="2" className={styles.detailsSubject}>
          {`${request.fromCity.name} → ${request.toCity.name}`}
        </Subheadline>
        <StatusPill tone={RIDE_REQUEST_STATUS_TONES[shownStatus]}>
          {statusLabel}
        </StatusPill>
      </div>
      <Caption Component="div" className={styles.detailsMeta}>
        {`Окно: ${window}`}
      </Caption>
      <Caption Component="div" className={styles.detailsMeta}>
        {`${seats} · действует до ${formatMoscowDateTime(request.expiresAt)}`}
      </Caption>

      {shownStatus === "expired" && (
        <Caption Component="p" role="status" className={styles.detailsMeta}>
          Срок действия истёк — создайте новый запрос.
        </Caption>
      )}
      {error && (
        <Notice tone="danger" variant="text">
          {bookingErrorMessage(error)}
        </Notice>
      )}

      {editing ? (
        <>
          <GroupLabel Component="div">Редактирование запроса</GroupLabel>
          <Field label="Не раньше" id={`ride-edit-earliest-${request.id}`}>
            {(field) => (
              <Input
                {...field}
                type="datetime-local"
                value={editEarliest}
                onChange={(event) => setEditEarliest(event.target.value)}
              />
            )}
          </Field>
          <Field label="Не позже" id={`ride-edit-latest-${request.id}`}>
            {(field) => (
              <Input
                {...field}
                type="datetime-local"
                value={editLatest}
                onChange={(event) => setEditLatest(event.target.value)}
              />
            )}
          </Field>
          <Field label="Действует до" id={`ride-edit-expires-${request.id}`}>
            {(field) => (
              <Input
                {...field}
                type="datetime-local"
                value={editExpires}
                onChange={(event) => setEditExpires(event.target.value)}
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
                max={MAX_SEATS}
                value={editSeats}
                onChange={(event) => setEditSeats(event.target.value)}
              />
            )}
          </Field>
          {/* Плашка нужна только когда поле null: иначе ошибка рисуется
              самим <Field>. */}
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
              onClick={submitEdit}
            >
              Сохранить
            </Button>
            <Button
              size="s"
              stretched
              className={MIN_TARGET}
              disabled={update.isPending}
              onClick={() => {
                setEditing(false);
                setEditError(null);
              }}
            >
              Отмена
            </Button>
          </div>
        </>
      ) : live ? (
        <>
          <GroupLabel Component="div">Управление запросом</GroupLabel>
          <Button
            stretched
            size="m"
            loading={status.isPending}
            disabled={status.isPending || cancel.isPending}
            onClick={() =>
              status.mutate({
                id: request.id,
                status: shownStatus === "active" ? "paused" : "active",
              })
            }
          >
            {shownStatus === "active" ? "На паузу" : "Возобновить"}
          </Button>
          <Button
            stretched
            size="m"
            variant="outline"
            disabled={status.isPending || cancel.isPending}
            onClick={startEdit}
          >
            Редактировать
          </Button>
          <ConfirmPopup
            label="Удалить запрос"
            confirmLabel="Удалить запрос"
            description="Запрос будет снят с публикации и останется в истории."
            pending={cancel.isPending}
            mode="plain"
            destructive
            nested
            className={MIN_TARGET}
            onConfirm={() =>
              cancel.mutate(request.id, {
                onSuccess: () => {
                  haptic.success();
                  onClose();
                },
                onError: () => haptic.error(),
              })
            }
          />
        </>
      ) : null}
    </Stack>
  );
}
