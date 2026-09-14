import { useState } from "react";
import {
  Button,
  IconButton,
  Input,
  Modal,
  Placeholder,
  Switch,
  Textarea,
} from "@telegram-apps/telegram-ui";
import {
  ArrowRightLeft,
  Calendar,
  Clock,
  MapPin,
  Navigation,
  RussianRuble,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MutationError } from "@/components/MutationError";
import { useToast } from "@/components/ToastProvider";
import { OfflineBanner } from "@/components/OfflineBanner";
import { TripsPage } from "@/pages/TripsPage";
import { TRIP_TAGS } from "@/consts/tags";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useCreateTripMutation } from "@/queries/useTripsQuery";
import { validateCreateTripDraft } from "@/helpers/createTripForm";
import type { TripTag } from "@edem/contracts";

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

/**
 * Создание поездки — модальная шторка поверх «Поездок» (модель примера:
 * в Telegram нет «новых страниц», только модалки; роут /trips/my/new
 * остаётся источником правды ради диплинков и кнопки «Создать»).
 * Карточки «Маршрут» (города из справочника + адреса + swap), «Поездка»,
 * «Условия и комментарий» (Switch-теги до 6 + комментарий). Валидация —
 * createTripDtoSchema (бэкенд — авторитет), успех — toast + детали поездки.
 */
export function CreateTripModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (tripId: string) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Создать поездку</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto">
        <CreateTripBody onCreated={onCreated} />
      </div>
    </Modal>
  );
}

/**
 * Роут /trips/my/new: фон — «Поездки» (сегмент водителя), поверх —
 * шторка создания. Успех — замена на детали созданной поездки.
 */
export function CreateTripRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/bookings?segment=driver", { replace: true });
  };
  return (
    <>
      <TripsPage />
      <CreateTripModal
        open
        onClose={close}
        onCreated={(tripId) => navigate(`/trips/${tripId}`, { replace: true })}
      />
    </>
  );
}

/** Тело формы (экспортировано для SSR-тестов: Modal — портал, в renderToString не попадает). */
export function CreateTripBody({ onCreated }: { onCreated: (tripId: string) => void }) {
  const toast = useToast();
  const cities = useAllCitiesQuery();
  const create = useCreateTripMutation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [date, setDate] = useState(tomorrow().slice(0, 16));
  const [durationHours, setDurationHours] = useState("1");
  const [distanceKm, setDistanceKm] = useState("");
  const [price, setPrice] = useState("500");
  const [seats, setSeats] = useState("1");
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<TripTag[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Несохранённый черновик — Telegram спросит подтверждение закрытия.
  useClosingConfirmation(
    from !== "" ||
      to !== "" ||
      fromAddress !== "" ||
      toAddress !== "" ||
      distanceKm !== "" ||
      comment !== "" ||
      tags.length > 0,
  );

  const swapCities = () => {
    haptic.selection();
    setFrom(to);
    setTo(from);
    setFromAddress(toAddress);
    setToAddress(fromAddress);
  };

  const toggleTag = (tag: TripTag, checked: boolean) => {
    haptic.selection();
    setTags((prev) =>
      checked
        ? prev.includes(tag)
          ? prev
          : [...prev, tag].slice(0, 6)
        : prev.filter((item) => item !== tag),
    );
  };

  const submit = () => {
    setValidationError(null);
    const validation = validateCreateTripDraft(
      {
        fromName: from,
        toName: to,
        fromAddress,
        toAddress,
        date,
        durationHours,
        distanceKm,
        price,
        seats,
        tags,
        comment,
      },
      cities.data,
    );
    if (!validation.ok) {
      setValidationError(validation.error);
      return;
    }
    create.mutate(validation.data, {
      onSuccess: (trip) => {
        haptic.success();
        toast.show({
          text: "Поездка опубликована!",
          description: `${trip.fromCity} → ${trip.toCity} появилась в поиске`,
        });
        onCreated(trip.id);
      },
    });
  };

  if (cities.isLoading) {
    return <Placeholder>Загружаем города…</Placeholder>;
  }

  return (
    <>
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 pt-1">
        {/* Маршрут */}
        <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-(--tgui--text_color)">Маршрут</span>
          <div className="flex flex-col gap-1.5 relative">
            <div className="FormField">
              <label htmlFor="create-from">Город отправления</label>
              <Input
                id="create-from"
                before={<MapPin size={17} className="text-(--app-info)" />}
                list="trip-cities"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder="Откуда едем"
              />
            </div>
            <div className="FormField">
              <label htmlFor="create-to">Город назначения</label>
              <Input
                id="create-to"
                before={<MapPin size={17} className="text-(--app-success)" />}
                list="trip-cities"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="Куда едем"
              />
            </div>
            <IconButton
              type="button"
              size="s"
              mode="plain"
              onClick={swapCities}
              aria-label="Поменять направление"
              className="absolute! right-2! top-9.5! bg-(--tgui--section_bg_color)! shadow-xs!"
            >
              <ArrowRightLeft size={14} className="text-(--app-info)" />
            </IconButton>
          </div>
          <div className="FormField">
            <label htmlFor="create-from-address">Адрес отправления</label>
            <Input
              id="create-from-address"
              before={<Navigation size={16} className="text-(--tgui--hint_color)" />}
              value={fromAddress}
              onChange={(event) => setFromAddress(event.target.value)}
              placeholder="Точка встречи"
            />
          </div>
          <div className="FormField">
            <label htmlFor="create-to-address">Адрес назначения</label>
            <Input
              id="create-to-address"
              before={<Navigation size={16} className="text-(--tgui--hint_color)" />}
              value={toAddress}
              onChange={(event) => setToAddress(event.target.value)}
              placeholder="Точка прибытия"
            />
          </div>
          <datalist id="trip-cities">
            {cities.data?.map((city) => <option key={city.id} value={city.name} />)}
          </datalist>
        </div>

        {/* Поездка */}
        <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-(--tgui--text_color)">Поездка</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="FormField">
              <label htmlFor="create-date">Дата и время</label>
              <Input
                id="create-date"
                before={<Calendar size={16} className="text-(--tgui--hint_color)" />}
                type="datetime-local"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="FormField">
              <label htmlFor="create-duration">В пути, часов</label>
              <Input
                id="create-duration"
                before={<Clock size={16} className="text-(--tgui--hint_color)" />}
                type="number"
                min="1"
                max="168"
                value={durationHours}
                onChange={(event) => setDurationHours(event.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="FormField">
              <label htmlFor="create-distance">Расстояние, км</label>
              <Input
                id="create-distance"
                type="number"
                min="1"
                max="20000"
                value={distanceKm}
                onChange={(event) => setDistanceKm(event.target.value)}
                placeholder="180"
              />
            </div>
            <div className="FormField">
              <label htmlFor="create-price">Цена, ₽</label>
              <Input
                id="create-price"
                before={<RussianRuble size={16} className="text-(--tgui--hint_color)" />}
                type="number"
                min="1"
                max="100000"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
          </div>
          <div className="FormField">
            <label htmlFor="create-seats">Места</label>
            <Input
              id="create-seats"
              before={<Users size={16} className="text-(--tgui--hint_color)" />}
              type="number"
              min="1"
              max="3"
              value={seats}
              onChange={(event) => setSeats(event.target.value)}
            />
          </div>
        </div>

        {/* Условия и комментарий */}
        <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-(--tgui--text_color)">
              Условия поездки
            </span>
            <span className="text-[11px] text-(--tgui--hint_color)">
              {`до 6 · выбрано ${tags.length}`}
            </span>
          </div>
          {TRIP_TAGS.map((tag) => (
            <div key={tag} className="flex items-center justify-between text-xs">
              <span className="text-(--tgui--text_color)">{tag}</span>
              <Switch
                checked={tags.includes(tag)}
                onChange={(event) => toggleTag(tag, event.target.checked)}
                aria-label={tag}
              />
            </div>
          ))}
          <div className="FormField pt-1 border-t border-(--tgui--outline)">
            <label htmlFor="create-comment">Комментарий</label>
            <Textarea
              id="create-comment"
              rows={3}
              maxLength={500}
              placeholder="Например: едем спокойно, салон чистый, багажник свободен"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        </div>

        {validationError && <p className="FormError" role="alert">{validationError}</p>}
        <MutationError error={create.error} />
        <Button mode="bezeled" stretched size="l" loading={create.isPending} onClick={submit}>
          Опубликовать
        </Button>
      </div>
    </>
  );
}
