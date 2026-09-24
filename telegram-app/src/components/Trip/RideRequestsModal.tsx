import { memo } from "react";
import { useState } from "react";
import { Caption, Input, Text } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";

import { StatusPill } from "@/components/StatusPill/StatusPill";
import { Calendar, MapPin, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { QueryState } from "@/components/QueryState";
import { haptic } from "@/utils/haptics";
import { ConfirmPopup } from "@/components/ConfirmPopup";
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
        <Card className={styles.card}>
          <Text weight="2" Component="span">
            Новый запрос
          </Text>
          <Field label="Откуда" id="ride-from">
            {(field) => (
              <Input
                {...field}
                before={<MapPin size={17} className={styles.iconInfo} />}
                list="request-cities"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder="Город отправления"
              />
            )}
          </Field>
          <Field label="Куда" id="ride-to">
            {(field) => (
              <Input
                {...field}
                before={<MapPin size={17} className={styles.iconSuccess} />}
                list="request-cities"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="Город назначения"
              />
            )}
          </Field>
          <datalist id="request-cities">
            {cities.data?.map((city) => (
              <option key={city.id} value={city.name} />
            ))}
          </datalist>
          <div className={styles.grid2}>
            <Field label="Не раньше" id="ride-earliest">
              {(field) => (
                <Input
                  {...field}
                  before={<Calendar size={16} className={styles.iconHint} />}
                  type="datetime-local"
                  value={earliest}
                  onChange={(event) => setEarliest(event.target.value)}
                />
              )}
            </Field>
            <Field label="Не позже" id="ride-latest">
              {(field) => (
                <Input
                  {...field}
                  before={<Calendar size={16} className={styles.iconHint} />}
                  type="datetime-local"
                  value={latest}
                  onChange={(event) => setLatest(event.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Места" id="ride-seats">
            {(field) => (
              <Input
                {...field}
                before={<Users size={16} className={styles.iconHint} />}
                type="number"
                min="1"
                max="3"
                value={seats}
                onChange={(event) => setSeats(event.target.value)}
              />
            )}
          </Field>
          {validationError && (
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
            className="min-h-11"
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
          emptyText="Активных запросов нет."
          onRetry={() => void requests.refetch()}
        >
          <Stack>
            {requests.data?.map((request) => (
              <Card key={request.id} className={styles.card}>
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
                    <Field label="Места" id={`ride-edit-seats-${request.id}`}>
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
                    {editError && (
                      <Notice tone="danger" variant="text">
                        {editError}
                      </Notice>
                    )}
                    <div className={styles.btnRow}>
                      <Button
                        stretched
                        size="s"
                        className="min-h-11"
                        loading={update.isPending}
                        onClick={() => submitEdit(request.id)}
                      >
                        Сохранить
                      </Button>
                      <Button
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
                          size="s"
                          stretched
                          className="min-h-11"
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
