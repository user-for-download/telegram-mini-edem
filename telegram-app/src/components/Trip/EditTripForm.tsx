import { useState } from "react";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { Chip, Input, Textarea } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { BTN_ROW, HINT } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { Button } from "@/ui/Button";

import { Calendar, Clock, MapPin, RussianRuble, Users } from "lucide-react";
import {
  MAX_SEATS,
  updateTripDtoSchema,
  type Trip,
  type TripTag,
} from "@edem/contracts";
import { TRIP_TAGS } from "@/consts/tags";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { useUpdateTripMutation } from "@/queries/useTripsQuery";
import styles from "./EditTripForm.module.css";

function toDateTimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Inline-редактирование поездки водителем.
 * Маршрут заблокирован сервером (strict-схема отвергает fromCity/toCity) —
 * UI его не показывает, отправляет только разрешённые поля.
 */
export function EditTripForm({
  trip,
  onDone,
}: {
  trip: Trip;
  onDone: () => void;
}) {
  const update = useUpdateTripMutation();
  const [fromAddress, setFromAddress] = useState(trip.fromAddress ?? "");
  const [toAddress, setToAddress] = useState(trip.toAddress ?? "");
  const [departure, setDeparture] = useState(toDateTimeLocal(trip.departureAt));
  const [durationHours, setDurationHours] = useState(
    String(Math.max(1, Math.round(trip.durationMinutes / 60))),
  );
  const [distanceKm, setDistanceKm] = useState(String(trip.distanceKm));
  const [price, setPrice] = useState(String(trip.price));
  const [seats, setSeats] = useState(String(trip.seatsTotal));
  const [tags, setTags] = useState<TripTag[]>([...(trip.tags ?? [])]);
  const [comment, setComment] = useState(trip.comment ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Несохранённые правки — Telegram спросит подтверждение закрытия.
  // Сравнение с начальными значениями (см. useState выше): теги —
  // JSON-сравнением (порядок toggle не меняет, дубли запрещены).
  useClosingConfirmation(
    fromAddress !== (trip.fromAddress ?? "") ||
      toAddress !== (trip.toAddress ?? "") ||
      departure !== toDateTimeLocal(trip.departureAt) ||
      durationHours !==
        String(Math.max(1, Math.round(trip.durationMinutes / 60))) ||
      distanceKm !== String(trip.distanceKm) ||
      price !== String(trip.price) ||
      seats !== String(trip.seatsTotal) ||
      JSON.stringify(tags) !== JSON.stringify(trip.tags ?? []) ||
      comment !== (trip.comment ?? ""),
  );

  const toggleTag = (tag: TripTag) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  };

  const submit = () => {
    setValidationError(null);
    const departureAt = new Date(departure);
    if (!Number.isFinite(departureAt.getTime()) || departureAt <= new Date()) {
      setValidationError("Укажите будущие дату и время отправления");
      return;
    }
    const parsed = updateTripDtoSchema.safeParse({
      fromAddress: fromAddress.trim(),
      toAddress: toAddress.trim(),
      departureAt: departureAt.toISOString(),
      durationMinutes: Number(durationHours) * 60,
      distanceKm: Number(distanceKm),
      price: Number(price),
      seatsTotal: Number(seats),
      tags,
      comment: comment.trim() ? comment.trim() : undefined,
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? "Проверьте данные поездки",
      );
      return;
    }
    update.mutate(
      { id: trip.id, data: parsed.data },
      { onSuccess: () => onDone() },
    );
  };

  return (
    <>
      <div className={styles.form}>
        <p>Маршрут изменить нельзя — только адреса, время и условия.</p>
        <Field label="Адрес отправления" id="edit-from">
          {(field) => (
            <Input
              {...field}
              before={<MapPin size={17} className={styles.iconInfo} />}
              value={fromAddress}
              onChange={(event) => setFromAddress(event.target.value)}
              placeholder="Например: м. Тёплый Стан"
            />
          )}
        </Field>
        <Field label="Адрес назначения" id="edit-to">
          {(field) => (
            <Input
              {...field}
              before={<MapPin size={17} className={styles.iconSuccess} />}
              value={toAddress}
              onChange={(event) => setToAddress(event.target.value)}
              placeholder="Например: пр-т Ленина"
            />
          )}
        </Field>
        <Field label="Дата и время" id="edit-departure">
          {(field) => (
            <Input
              {...field}
              before={<Calendar size={16} className={HINT} />}
              type="datetime-local"
              value={departure}
              onChange={(event) => setDeparture(event.target.value)}
            />
          )}
        </Field>
        <div className={styles.grid2}>
          <Field label="В пути, часов" id="edit-duration">
            {(field) => (
              <Input
                {...field}
                before={<Clock size={16} className={HINT} />}
                type="number"
                min="1"
                max="168"
                value={durationHours}
                onChange={(event) => setDurationHours(event.target.value)}
              />
            )}
          </Field>
          <Field label="Расстояние, км" id="edit-distance">
            {(field) => (
              <Input
                {...field}
                type="number"
                min="1"
                max="20000"
                value={distanceKm}
                onChange={(event) => setDistanceKm(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={styles.grid2}>
          <Field label="Цена, ₽" id="edit-price">
            {(field) => (
              <Input
                {...field}
                before={<RussianRuble size={16} className={HINT} />}
                type="number"
                min="1"
                max="100000"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            )}
          </Field>
          <Field label="Места" id="edit-seats">
            {(field) => (
              <Input
                {...field}
                before={<Users size={16} className={HINT} />}
                type="number"
                min="1"
                max={MAX_SEATS}
                value={seats}
                onChange={(event) => setSeats(event.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend>Особенности</legend>
          <div className={styles.tagChips}>
            {TRIP_TAGS.map((tag) => {
              const checked = tags.includes(tag);
              return (
                <Chip
                  key={tag}
                  className={styles.tagChip}
                  Component="button"
                  type="button"
                  mode={checked ? "elevated" : "mono"}
                  onClick={() => toggleTag(tag)}
                  aria-pressed={checked}
                >
                  {tag}
                </Chip>
              );
            })}
          </div>
        </fieldset>
        <Field label="Комментарий пассажирам" id="edit-comment">
          {(field) => (
            <Textarea
              {...field}
              value={comment}
              maxLength={500}
              rows={3}
              placeholder="Например: одна остановка в пути, багажник свободен"
              status={validationError ? "error" : undefined}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
        {validationError && (
          <Notice tone="danger" variant="text">
            {validationError}
          </Notice>
        )}
        {update.error && (
          <Notice tone="danger" variant="text">
            {bookingErrorMessage(update.error)}
          </Notice>
        )}
        <div className={BTN_ROW}>
          <Button
            stretched
            size="m"
            loading={update.isPending}
            onClick={submit}
          >
            Сохранить
          </Button>
          <Button
            size="m"
            stretched
            disabled={update.isPending}
            onClick={onDone}
          >
            Отмена
          </Button>
        </div>
      </div>
    </>
  );
}
