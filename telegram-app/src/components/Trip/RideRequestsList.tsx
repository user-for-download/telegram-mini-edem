import { memo, useState } from "react";
import { MAX_SEATS } from "@edem/contracts";
import { Caption, Input, Text } from "@telegram-apps/telegram-ui";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { QueryState } from "@/components/QueryState";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { BTN_ROW, MIN_TARGET, TRUNCATE } from "@/ui/classes";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { Stack } from "@/ui/Stack";
import { FetchMore } from "@/ui/FetchMore";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import {
  useCancelRideRequestMutation,
  useRideRequestsQuery,
  useRideRequestStatusMutation,
  useUpdateRideRequestMutation,
} from "@/queries/useRideRequestsQuery";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { isRideRequestExpired } from "./rideRequestValidation";
import { mergeUniqueById } from "@/helpers/mergeUniqueById";
import { haptic } from "@/utils/haptics";
import { formatMoscowDateTime, fromMoscowDateTimeInput, toLocalDateTimeInputValue } from "@/utils/date";
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
import { listBlockingError } from "@/helpers/listBlockingError";

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
  // Бесконечная лента: свои заявки копятся (терминальные остаются в
  // истории), поэтому список обязан уметь догружать страницы — раньше
  // pagination выбрасывалась и было видно только первые 20.
  // mergeUniqueById, а не flatMap: /ride-requests — offset-пагинация
  // (skip/take) по списку, в который новая заявка встаёт В НАЧАЛО и сдвигает
  // окно, поэтому граничная строка приезжала второй раз и карточка
  // дублировалась (React ругался на повторный key).
  const items = mergeUniqueById(requests.data?.pages);
  const sentinelRef = useInfiniteSentinel({
    hasNextPage: requests.hasNextPage,
    isFetchingNextPage: requests.isFetchingNextPage,
    // Пятый вызов хука в приложении: те же четыре ленты уже передают
    // `disabled`, эта — нет. После сбоя страницы N+1 hasNextPage остаётся
    // истинным, а плейсхолдер возвращает сентинел во вьюпорт — observer
    // бил бы по кругу (MEMORY.md §18).
    disabled: requests.isFetchNextPageError,
    fetchNextPage: () => {
      void requests.fetchNextPage();
    },
  });
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

  const submitEdit = (requestId: string) => {
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
        error={listBlockingError(requests)}
        empty={items.length === 0}
        emptyText={EMPTY_STATES.rideRequestsEmpty.description}
        onRetry={() => void requests.refetch()}
      >
        <Stack>
          {items.map((request) => {
            // Статус в базе у просроченной заявки навсегда остаётся
            // active/paused (его никто не переписывает), поэтому подпись и
            // тон считаем по фактическому сроку, а не по записанному статусу.
            const expired = isRideRequestExpired(request);
            // Имя НЕ `status`: в этом же map есть мутация `status`, и
            // затенение ломало бы обращения к status.isPending ниже.
            const shownStatus: RideRequestStatus = expired
              ? "expired"
              : request.status;
            // Управление (пауза/возобновление, правка, отмена) есть только у
            // живой заявки; истёкшая покажет подсказку вместо кнопок.
            const live = shownStatus === "active" || shownStatus === "paused";
            return (
              <Card key={request.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <Text weight="2" Component="span" className={TRUNCATE}>
                    {`${request.fromCity.name} → ${request.toCity.name}`}
                  </Text>
                  <StatusPill tone={RIDE_REQUEST_STATUS_TONES[shownStatus]}>
                    {RIDE_REQUEST_STATUS_LABELS[shownStatus]}
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
                          max={MAX_SEATS}
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
                  <>
                    {/* Действия живой заявки: состояние («На паузу» /
                        «Возобновить») и правка — ПАРА равных кнопок в одну
                        строку, отмена — тихим красным текстом под ними
                        (`ConfirmPopup mode="plain" destructive`, тот же приём,
                        что у «Удалить профиль»). Деструктив не должен весить
                        столько же, сколько правка.
                        Почему подписи короткие: в прежней раскладке
                        (`BTN_ROW_WRAP` + `stretched`) три кнопки разъезжались
                        в три ПОЛНЫЕ строки по 290×44 — «ряд» был обманом, —
                        а в честном ряду из двух длинная подпись не влезает:
                        «Поставить на паузу» и «Отменить запрос» требовали
                        ~150px каждая при доступных 141 (замер: подпись
                        обрезалась многоточием). */}
                    {live && (
                      <div className={BTN_ROW}>
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
                              status.mutate({
                                id: request.id,
                                status: "paused",
                              })
                            }
                          >
                            На паузу
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
                              status.mutate({
                                id: request.id,
                                status: "active",
                              })
                            }
                          >
                            Возобновить
                          </Button>
                        )}
                        <Button
                          size="s"
                          stretched
                          className={MIN_TARGET}
                          disabled={status.isPending || cancel.isPending}
                          onClick={() => startEdit(request)}
                        >
                          Редактировать
                        </Button>
                      </div>
                    )}
                    {live && (
                      <ConfirmPopup
                        label="Отменить запрос"
                        confirmLabel="Отменить запрос"
                        description="Запрос будет снят с публикации."
                        pending={cancel.isPending}
                        mode="plain"
                        destructive
                        className={MIN_TARGET}
                        onConfirm={() => cancel.mutate(request.id)}
                      />
                    )}
                    {expired && (
                      <Caption Component="div">
                        Срок действия истёк — создайте новый запрос.
                      </Caption>
                    )}
                  </>
                )}
              </Card>
            );
          })}
          <FetchMore
            hasNextPage={requests.hasNextPage}
            isFetchingNextPage={requests.isFetchingNextPage}
            fetchNextPage={() => void requests.fetchNextPage()}
            error={requests.isFetchNextPageError ? requests.error : null}
            sentinelRef={sentinelRef}
          />
        </Stack>
      </QueryState>
    </>
  );
});
