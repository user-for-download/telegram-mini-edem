import { useState } from "react";
import {
  Button,
  Caption,
  Chip,
  Input,
  Textarea,
} from "@telegram-apps/telegram-ui";
import {
  Calendar,
  Clock,
  MapPin,
  RussianRuble,
  Users,
} from "lucide-react";
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
        <div>
          <label htmlFor="edit-from" className="sr-only">
            Адрес отправления
          </label>
          <Input
            id="edit-from"
            header="Адрес отправления"
            before={<MapPin size={17} className={styles.iconInfo} />}
            value={fromAddress}
            onChange={(event) => setFromAddress(event.target.value)}
            placeholder="Например: м. Тёплый Стан"
          />
        </div>
        <div>
          <label htmlFor="edit-to" className="sr-only">
            Адрес назначения
          </label>
          <Input
            id="edit-to"
            header="Адрес назначения"
            before={<MapPin size={17} className={styles.iconSuccess} />}
            value={toAddress}
            onChange={(event) => setToAddress(event.target.value)}
            placeholder="Например: пр-т Ленина"
          />
        </div>
        <div>
          <label htmlFor="edit-departure" className="sr-only">
            Дата и время
          </label>
          <Input
            id="edit-departure"
            header="Дата и время"
            before={
              <Calendar size={16} className={styles.iconHint} />
            }
            type="datetime-local"
            value={departure}
            onChange={(event) => setDeparture(event.target.value)}
          />
        </div>
        <div className={styles.grid2}>
          <div>
            <label htmlFor="edit-duration" className="sr-only">
              В пути, часов
            </label>
            <Input
              id="edit-duration"
              header="В пути, часов"
              before={<Clock size={16} className={styles.iconHint} />}
              type="number"
              min="1"
              max="168"
              value={durationHours}
              onChange={(event) => setDurationHours(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="edit-distance" className="sr-only">
              Расстояние, км
            </label>
            <Input
              id="edit-distance"
              header="Расстояние, км"
              type="number"
              min="1"
              max="20000"
              value={distanceKm}
              onChange={(event) => setDistanceKm(event.target.value)}
            />
          </div>
        </div>
        <div className={styles.grid2}>
          <div>
            <label htmlFor="edit-price" className="sr-only">
              Цена, ₽
            </label>
            <Input
              id="edit-price"
              header="Цена, ₽"
              before={
                <RussianRuble size={16} className={styles.iconHint} />
              }
              type="number"
              min="1"
              max="100000"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="edit-seats" className="sr-only">
              Места
            </label>
            <Input
              id="edit-seats"
              header="Места"
              before={<Users size={16} className={styles.iconHint} />}
              type="number"
              min="1"
              max={MAX_SEATS}
              value={seats}
              onChange={(event) => setSeats(event.target.value)}
            />
          </div>
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
        <div>
          <label htmlFor="edit-comment" className="sr-only">
            Комментарий пассажирам
          </label>
          <Textarea
            id="edit-comment"
            header="Комментарий пассажирам"
            value={comment}
            maxLength={500}
            rows={3}
            placeholder="Например: одна остановка в пути, багажник свободен"
            status={validationError ? "error" : undefined}
            onChange={(event) => setComment(event.target.value)}
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
        {update.error && (
          <Caption
            Component="p"
            role="alert"
            className={styles.errorText}
          >
            {bookingErrorMessage(update.error)}
          </Caption>
        )}
        <div className={styles.btnRow}>
          <Button
            mode="bezeled"
            stretched
            size="m"
            loading={update.isPending}
            onClick={submit}
          >
            Сохранить
          </Button>
          <Button
            mode="bezeled"
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
