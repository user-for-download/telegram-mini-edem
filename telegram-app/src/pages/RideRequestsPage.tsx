import { useState } from "react";
import {
  Button,
  Caption,
  Input,
  Section,
  Text,
} from "@telegram-apps/telegram-ui";
import { FeedCard } from "@/components/FeedCard";
import { StatusPill } from "@/components/StatusPill";
import { Calendar, MapPin, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ConfirmAction } from "@/components/ConfirmAction";
import { OfflineBanner } from "@/components/OfflineBanner";
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
 * Запросы «Ищу попутку» (паритет VK RideRequestsPanel): создание, inline-
 * редактирование (PATCH, строгая схема бэкенда), пауза/возобновление,
 * отмена через confirm-guard, retry/offline.
 */
export function RideRequestsPage() {
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
        setFrom("");
        setTo("");
        setEarliest("");
        setLatest("");
      },
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
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <>
      <PageHeader title="Ищу попутку" />
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
        <Section header="Новый запрос">
          <div className="flex flex-col gap-3 p-4">
            <div>
              <label htmlFor="ride-from" className="sr-only">
                Откуда
              </label>
              <Input
                id="ride-from"
                header="Откуда"
                before={<MapPin size={17} className="text-(--app-info)" />}
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
                before={<MapPin size={17} className="text-(--app-success)" />}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ride-earliest" className="sr-only">
                  Не раньше
                </label>
                <Input
                  id="ride-earliest"
                  header="Не раньше"
                  before={
                    <Calendar size={16} className="text-(--tgui--hint_color)" />
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
                    <Calendar size={16} className="text-(--tgui--hint_color)" />
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
                before={
                  <Users size={16} className="text-(--tgui--hint_color)" />
                }
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
                className="text-(--tg-theme-destructive-text-color)"
              >
                {validationError}
              </Caption>
            )}
            {create.error && (
              <Caption
                Component="p"
                role="alert"
                className="text-(--tg-theme-destructive-text-color)"
              >
                {bookingErrorMessage(create.error)}
              </Caption>
            )}
            <Button
              mode="bezeled"
              stretched
              size="l"
              loading={create.isPending}
              onClick={submit}
            >
              Опубликовать запрос
            </Button>
          </div>
        </Section>
        {(status.error || cancel.error || update.error) && (
          <Caption
            Component="p"
            role="alert"
            className="text-(--tg-theme-destructive-text-color)"
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
          <div className="flex flex-col gap-3">
            {requests.data?.map((request) => (
              <FeedCard key={request.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <Text weight="2" Component="span" className="truncate">
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
                        className="text-(--tg-theme-destructive-text-color)"
                      >
                        {editError}
                      </Caption>
                    )}
                    <div className="flex gap-2">
                      <Button
                        mode="bezeled"
                        stretched
                        size="s"
                        loading={update.isPending}
                        onClick={() => submitEdit(request.id)}
                      >
                        Сохранить
                      </Button>
                      <Button
                        mode="bezeled"
                        size="s"
                        stretched
                        disabled={update.isPending}
                        onClick={() => setEditingId(null)}
                      >
                        Отмена
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {request.status === "active" && (
                      <Button
                        mode="bezeled"
                        size="s"
                        stretched
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
                          disabled={status.isPending || cancel.isPending}
                          onClick={() => startEdit(request)}
                        >
                          Редактировать
                        </Button>
                        <ConfirmAction
                          label="Отменить запрос"
                          confirmLabel="Отменить запрос"
                          description="Запрос будет снят с публикации."
                          pending={cancel.isPending}
                          onConfirm={() => cancel.mutate(request.id)}
                        />
                      </>
                    )}
                  </div>
                )}
              </FeedCard>
            ))}
          </div>
        </QueryState>
      </div>
    </>
  );
}
