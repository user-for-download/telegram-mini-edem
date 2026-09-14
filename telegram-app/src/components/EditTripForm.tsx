import { useState } from "react";
import {
  Button,
  Chip,
  Input,
  Textarea,
} from "@telegram-apps/telegram-ui";
import {
  Calendar,
  Clock,
  MapPin,
  Navigation,
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

function toDateTimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Inline-редактирование поездки водителем (паритет VK EditTripModal).
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
      <div className="flex flex-col gap-3 border-t border-(--tgui--outline) pt-3">
        <p>Маршрут изменить нельзя — только адреса, время и условия.</p>
        <div className="FormField">
          <label htmlFor="edit-from">Адрес отправления</label>
          <Input
            id="edit-from"
            before={<MapPin size={17} className="text-(--app-info)" />}
            value={fromAddress}
            onChange={(event) => setFromAddress(event.target.value)}
            placeholder="Например: м. Тёплый Стан"
          />
        </div>
        <div className="FormField">
          <label htmlFor="edit-to">Адрес назначения</label>
          <Input
            id="edit-to"
            before={<MapPin size={17} className="text-(--app-success)" />}
            value={toAddress}
            onChange={(event) => setToAddress(event.target.value)}
            placeholder="Например: пр-т Ленина"
          />
        </div>
        <div className="FormField">
          <label htmlFor="edit-departure">Дата и время</label>
          <Input
            id="edit-departure"
            before={<Calendar size={16} className="text-(--tgui--hint_color)" />}
            type="datetime-local"
            value={departure}
            onChange={(event) => setDeparture(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="FormField">
            <label htmlFor="edit-duration">В пути, часов</label>
            <Input
              id="edit-duration"
              before={<Clock size={16} className="text-(--tgui--hint_color)" />}
              type="number"
              min="1"
              max="168"
              value={durationHours}
              onChange={(event) => setDurationHours(event.target.value)}
            />
          </div>
          <div className="FormField">
            <label htmlFor="edit-distance">Расстояние, км</label>
            <Input
              id="edit-distance"
              type="number"
              min="1"
              max="20000"
              value={distanceKm}
              onChange={(event) => setDistanceKm(event.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="FormField">
            <label htmlFor="edit-price">Цена, ₽</label>
            <Input
              id="edit-price"
              before={<RussianRuble size={16} className="text-(--tgui--hint_color)" />}
              type="number"
              min="1"
              max="100000"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
          <div className="FormField">
            <label htmlFor="edit-seats">Места (1–{MAX_SEATS})</label>
            <Input
              id="edit-seats"
              before={<Users size={16} className="text-(--tgui--hint_color)" />}
              type="number"
              min="1"
              max={MAX_SEATS}
              value={seats}
              onChange={(event) => setSeats(event.target.value)}
            />
          </div>
        </div>
        <fieldset className="FormField">
          <legend>Особенности</legend>
          <div className="TagChips">
            {TRIP_TAGS.map((tag) => {
              const checked = tags.includes(tag);
              return (
                <Chip
                  key={tag}
                  className="TagChip"
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
        <div className="FormField">
          <label htmlFor="edit-comment">Комментарий пассажирам</label>
          <Textarea
            id="edit-comment"
            value={comment}
            maxLength={500}
            rows={3}
            placeholder="Например: одна остановка в пути, багажник свободен"
            status={validationError ? "error" : "default"}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        {validationError && (
          <p className="FormError" role="alert">
            {validationError}
          </p>
        )}
        {update.error && (
          <p className="FormError" role="alert">
            {bookingErrorMessage(update.error)}
          </p>
        )}
        <div className="flex gap-2">
          <Button mode="bezeled" stretched size="m" loading={update.isPending} onClick={submit}>
            Сохранить
          </Button>
          <Button mode="bezeled" size="m" stretched disabled={update.isPending} onClick={onDone}>
            Отмена
          </Button>
        </div>
      </div>
    </>
  );
}
