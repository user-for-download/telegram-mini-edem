import { useState } from "react";
import { Button, Input, Section } from "@telegram-apps/telegram-ui";
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
    create.mutate(parsed.data, { onSuccess: () => { setFrom(""); setTo(""); setEarliest(""); setLatest(""); } });
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
        <div className="FormField">
          <label htmlFor="ride-from">Откуда</label>
          <Input
            id="ride-from"
            before={<MapPin size={17} className="text-(--app-info)" />}
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
            before={<MapPin size={17} className="text-(--app-success)" />}
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
              before={<Calendar size={16} className="text-(--tgui--hint_color)" />}
              type="datetime-local"
              value={earliest}
              onChange={(event) => setEarliest(event.target.value)}
            />
          </div>
          <div className="FormField">
            <label htmlFor="ride-latest">Не позже</label>
            <Input
              id="ride-latest"
              before={<Calendar size={16} className="text-(--tgui--hint_color)" />}
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
            before={<Users size={16} className="text-(--tgui--hint_color)" />}
            type="number"
            min="1"
            max="3"
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />
        </div>
        {validationError && <p className="FormError" role="alert">{validationError}</p>}
        {create.error && <p className="FormError" role="alert">{bookingErrorMessage(create.error)}</p>}
        <Button mode="bezeled" stretched size="l" loading={create.isPending} onClick={submit}>Опубликовать запрос</Button>
        </div>
      </Section>
      {(status.error || cancel.error || update.error) && (
        <p className="FormError" role="alert">
          {bookingErrorMessage(status.error ?? cancel.error ?? update.error)}
        </p>
      )}
      <QueryState loading={requests.isLoading} error={requests.error} empty={!requests.data?.length} emptyText="Активных запросов нет." onRetry={() => void requests.refetch()}>
        <div className="flex flex-col gap-3">
          {requests.data?.map((request) => (
            <FeedCard
              key={request.id}
              className="p-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-bold text-(--tgui--text_color) truncate">
                  {`${request.fromCity.name} → ${request.toCity.name}`}
                </span>
                <StatusPill
                  tone={request.status === "active" ? "success" : "warning"}
                >
                  {request.status === "active" ? "Активен" : request.status}
                </StatusPill>
              </div>
              <div className="text-[13px] text-(--tgui--hint_color)">
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
                    <Button mode="bezeled" stretched size="s" loading={update.isPending} onClick={() => submitEdit(request.id)}>Сохранить</Button>
                    <Button mode="bezeled" size="s" stretched disabled={update.isPending} onClick={() => setEditingId(null)}>Отмена</Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {request.status === "active" && (
                    <Button mode="bezeled" size="s" stretched loading={status.isPending && status.variables?.id === request.id} disabled={status.isPending || cancel.isPending} onClick={() => status.mutate({ id: request.id, status: "paused" })}>
                      Поставить на паузу
                    </Button>
                  )}
                  {request.status === "paused" && (
                    <Button mode="bezeled" size="s" stretched loading={status.isPending && status.variables?.id === request.id} disabled={status.isPending || cancel.isPending} onClick={() => status.mutate({ id: request.id, status: "active" })}>
                      Возобновить
                    </Button>
                  )}
                  {(request.status === "active" || request.status === "paused") && (
                    <>
                      <Button mode="bezeled" size="s" stretched disabled={status.isPending || cancel.isPending} onClick={() => startEdit(request)}>
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
