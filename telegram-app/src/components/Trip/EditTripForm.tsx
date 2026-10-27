import { useState } from "react";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import { Chip } from "@/ui/Chip";
import { Notice } from "@/ui/Notice";
import { BTN_ROW, BTN_ROW_WRAP, HINT, INFO, SUCCESS } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { schemaErrorMessage } from "@/helpers/createTripForm";
import { fromMoscowDateTimeInput, toLocalDateTimeInputValue } from "@/utils/date";
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

interface EditTripDraft {
  fromAddress: string;
  toAddress: string;
  departure: string;
  durationMinutes: string;
  distanceKm: string;
  price: string;
  seats: string;
  tags: TripTag[];
  comment: string;
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
  // Начало — стенное время ПО МОСКВЕ (общий хелпер date.ts, пара к
  // fromMoscowDateTimeInput в submit): геттеры даты дали бы зону устройства,
  // и на клиенте вне МСК правка стартовала бы со сдвинутого времени.
  // Битый/пустой ISO — пустая строка (хелпер возвращает "" для Invalid Date).
  const initialDeparture = trip.departureAt
    ? toLocalDateTimeInputValue(new Date(trip.departureAt))
    : "";
  const initialDraft = (): EditTripDraft => ({
    fromAddress: trip.fromAddress ?? "",
    toAddress: trip.toAddress ?? "",
    departure: initialDeparture,
    // Минуты не округляются в часы: 110 минут остаются 110 в поле и PATCH.
    durationMinutes: String(trip.durationMinutes),
    distanceKm: String(trip.distanceKm),
    price: String(trip.price),
    seats: String(trip.seatsTotal),
    tags: [...(trip.tags ?? [])],
    comment: trip.comment ?? "",
  });
  const [draft, setDraft, clearDraft, captureSubmission] = useSessionDraft<EditTripDraft>(
    `trip:edit:${trip.id}`,
    initialDraft,
  );
  const {
    fromAddress, toAddress, departure, durationMinutes,
    distanceKm, price, seats, tags, comment,
  } = draft;
  const setField = <K extends keyof EditTripDraft>(
    field: K,
    value: EditTripDraft[K],
  ) =>
    setDraft((current) => ({ ...current, [field]: value }));
  // Ошибка приходит с полем: <Field error=…> ставит aria-invalid и
  // aria-describedby. Тексты DTO переводятся общим schemaErrorMessage.
  const [fieldError, setFieldError] = useState<{
    field: string | null;
    error: string;
  } | null>(null);
  const validationError = fieldError?.error ?? null;
  const errorFor = (id: string) =>
    fieldError?.field === id ? fieldError.error : undefined;

  // Несохранённые правки — Telegram спросит подтверждение закрытия.
  // Сравнение с данными поездки: теги —
  // JSON-сравнением (порядок toggle не меняет, дубли запрещены).
  useClosingConfirmation(
    fromAddress !== (trip.fromAddress ?? "") ||
      toAddress !== (trip.toAddress ?? "") ||
      departure !== initialDeparture ||
      durationMinutes !== String(trip.durationMinutes) ||
      distanceKm !== String(trip.distanceKm) ||
      price !== String(trip.price) ||
      seats !== String(trip.seatsTotal) ||
      JSON.stringify(tags) !== JSON.stringify(trip.tags ?? []) ||
      comment !== (trip.comment ?? ""),
  );

  const toggleTag = (tag: TripTag) => {
    setDraft((current) => ({
      ...current,
      tags: current.tags.includes(tag)
        ? current.tags.filter((item) => item !== tag)
        : [...current.tags, tag],
    }));
  };

  const submit = () => {
    setFieldError(null);
    // Строка поля — стенное время ПО МОСКВЕ (пара к хелперу выше):
    // `new Date(value)` читал бы её в зоне устройства и сдвигал отправление.
    const departureAt = fromMoscowDateTimeInput(departure);
    if (departureAt === null || departureAt <= new Date()) {
      setFieldError({
        field: "edit-departure",
        error: "Укажите будущие дату и время отправления",
      });
      return;
    }
    const parsed = updateTripDtoSchema.safeParse({
      fromAddress: fromAddress.trim(),
      toAddress: toAddress.trim(),
      departureAt: departureAt.toISOString(),
      durationMinutes: Number(durationMinutes),
      distanceKm: Number(distanceKm),
      price: Number(price),
      seatsTotal: Number(seats),
      tags,
      comment: comment.trim(),
    });
    if (!parsed.success) {
      setFieldError(
        schemaErrorMessage(parsed.error.issues[0]?.path ?? [], "edit"),
      );
      return;
    }
    const onCommitted = captureSubmission();
    update.mutate(
      { id: trip.id, data: parsed.data, onCommitted },
      {
        onSuccess: () => {
          if (!onCommitted()) return;
          onDone();
        },
      },
    );
  };

  return (
    <>
      <div className={styles.form}>
        <p>Маршрут изменить нельзя — только адреса, время и условия.</p>
        <Field label="Адрес отправления" id="edit-from" error={errorFor("edit-from")}>
          {(field) => (
            <Input
              {...field}
              before={<MapPin size={17} className={INFO} />}
              value={fromAddress}
              onChange={(event) => setField("fromAddress", event.target.value)}
              placeholder="Например: м. Тёплый Стан"
            />
          )}
        </Field>
        <Field label="Адрес назначения" id="edit-to" error={errorFor("edit-to")}>
          {(field) => (
            <Input
              {...field}
              before={<MapPin size={17} className={SUCCESS} />}
              value={toAddress}
              onChange={(event) => setField("toAddress", event.target.value)}
              placeholder="Например: пр-т Ленина"
            />
          )}
        </Field>
        <Field label="Дата и время" id="edit-departure" error={errorFor("edit-departure")}>
          {(field) => (
            <Input
              {...field}
              before={<Calendar size={16} className={HINT} />}
              type="datetime-local"
              value={departure}
              onChange={(event) => setField("departure", event.target.value)}
            />
          )}
        </Field>
        <div className={styles.grid2}>
          <Field label="В пути, минут" id="edit-duration" error={errorFor("edit-duration")}>
            {(field) => (
              <Input
                {...field}
                before={<Clock size={16} className={HINT} />}
                type="number"
                min="1"
                max={7 * 24 * 60}
                step="1"
                value={durationMinutes}
                onChange={(event) => setField("durationMinutes", event.target.value)}
              />
            )}
          </Field>
          <Field label="Расстояние, км" id="edit-distance" error={errorFor("edit-distance")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                min="1"
                max="20000"
                value={distanceKm}
                onChange={(event) => setField("distanceKm", event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={styles.grid2}>
          <Field label="Цена, ₽" id="edit-price" error={errorFor("edit-price")}>
            {(field) => (
              <Input
                {...field}
                before={<RussianRuble size={16} className={HINT} />}
                type="number"
                min="1"
                max="100000"
                value={price}
                onChange={(event) => setField("price", event.target.value)}
              />
            )}
          </Field>
          <Field label="Места" id="edit-seats" error={errorFor("edit-seats")}>
            {(field) => (
              <Input
                {...field}
                before={<Users size={16} className={HINT} />}
                type="number"
                min="1"
                max={MAX_SEATS}
                value={seats}
                onChange={(event) => setField("seats", event.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend>Особенности</legend>
          <div className={BTN_ROW_WRAP}>
            {TRIP_TAGS.map((tag) => {
              const checked = tags.includes(tag);
              return (
                <Chip
                  key={tag}
                  Component="button"
                  type="button"
                  variant={checked ? "active" : "quiet"}
                  tone="accent"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={checked}
                >
                  {tag}
                </Chip>
              );
            })}
          </div>
        </fieldset>
        <Field label="Комментарий пассажирам" id="edit-comment" error={errorFor("edit-comment")}>
          {(field) => (
            <Textarea
              {...field}
              value={comment}
              maxLength={500}
              rows={3}
              placeholder="Например: одна остановка в пути, багажник свободен"
              status={errorFor("edit-comment") ? "error" : undefined}
              onChange={(event) => setField("comment", event.target.value)}
            />
          )}
        </Field>
        {/* Поле равно null для ошибок без адресата (лимит тегов, неизвестный
            путь DTO) — тогда сообщение нужно показать здесь. */}
        {validationError && !fieldError?.field && (
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
            // Кит у `loading` не гасит кнопку: без `disabled` она остаётся
            // фокусируемой и активной во время сохранения.
            disabled={update.isPending}
            onClick={submit}
          >
            Сохранить
          </Button>
          <Button
            size="m"
            stretched
            disabled={update.isPending}
            onClick={() => {
              setDraft(initialDraft());
              clearDraft();
              setFieldError(null);
              onDone();
            }}
          >
            Отмена
          </Button>
        </div>
      </div>
    </>
  );
}
