import { useRef, useState } from "react";
import {
  Chip,
  IconButton,
  Input,
  Placeholder,
  Section,
  Select,
  Spinner,
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
import { OfflineBanner } from "@/components/OfflineBanner";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ToastProvider";
import { TRIP_TAGS } from "@/consts/tags";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useBottomBarAction } from "@/hooks/useBottomBarAction";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useCreateTripMutation } from "@/queries/useTripsQuery";
import { validateCreateTripDraft } from "@/helpers/createTripForm";
import type { TripTag } from "@edem/contracts";

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

/**
 * Создание поездки — отдельная страница (роут /trips/my/new).
 *
 * Почему не модалка: форма из 10+ полей в шторке с внутренним скроллом
 * (max-h 82dvh) неудобна — клавиатура перекрывает поля, CTA уезжает,
 * свайп-закрытие конфликтует со скроллом. На странице — естественный
  * скролл WebView, нативный BackButton (Shell показывает его на
  * некорневых роутах), CTA — кнопка «Опубликовать» в нижнем баре
  * (регистрация через useBottomBarAction) и всегда на виду.
 *
 * Поверхности — нативные Section, города — Select из справочника
 * (datalist в WebView не даёт нативного пикера), теги — Chip
 * (паритет поиска/редактирования), валидация — createTripDtoSchema.
 */
export function CreateTripPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Создать поездку" />
      <CreateTripForm
        onCreated={(tripId) => navigate(`/trips/${tripId}`, { replace: true })}
      />
    </>
  );
}

/** Тело формы (экспортировано для SSR-тестов). */
export function CreateTripForm({
  onCreated,
}: {
  onCreated: (tripId: string) => void;
}) {
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
  /** Якорь блока ошибок: валидатор отдаёт строку без id поля. */
  const errorRef = useRef<HTMLParagraphElement | null>(null);

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

  const toggleTag = (tag: TripTag) => {
    haptic.selection();
    setTags((prev) =>
      prev.includes(tag)
        ? prev.filter((item) => item !== tag)
        : [...prev, tag].slice(0, 6),
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
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      onError: () => {
        errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
  };

  // CTA живёт в нижнем баре (Shell): loading напрямую из мутации.
  useBottomBarAction({
    label: "Опубликовать",
    onSubmit: submit,
    loading: create.isPending,
    disabled: false,
  });

  if (cities.isLoading) {
    return (
      <Placeholder>
        <Spinner size="m" />
        <>Загружаем города…</>
      </Placeholder>
    );
  }

  return (
    <>
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
        <Section header="Маршрут">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1.5 relative">
              <div className="FormField">
                <label htmlFor="create-from">Город отправления</label>
                <Select
                  id="create-from"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                >
                  <option value="">Откуда едем</option>
                  {cities.data?.map((city) => (
                    <option key={city.id} value={city.name}>
                      {city.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="FormField">
                <label htmlFor="create-to">Город назначения</label>
                <Select
                  id="create-to"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                >
                  <option value="">Куда едем</option>
                  {cities.data?.map((city) => (
                    <option key={city.id} value={city.name}>
                      {city.name}
                    </option>
                  ))}
                </Select>
              </div>
              <IconButton
                type="button"
                size="s"
                mode="plain"
                onClick={swapCities}
                aria-label="Поменять направление"
                className="absolute! right-2! top-1/2! -translate-y-1/2! bg-(--tgui--section_bg_color)! shadow-xs!"
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
          </div>
        </Section>

        <Section header="Поездка">
          <div className="flex flex-col gap-3 p-4">
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
                  before={<MapPin size={16} className="text-(--tgui--hint_color)" />}
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
        </Section>

        <Section
          header="Условия поездки"
          footer={`до 6 · выбрано ${tags.length}`}
        >
          <div className="flex flex-col gap-3 p-4">
            <div className="TagChips" role="group" aria-label="Условия поездки">
              {TRIP_TAGS.map((tag) => {
                const checked = tags.includes(tag);
                return (
                  <Chip
                    key={tag}
                    className="TagChip"
                    Component="button"
                    type="button"
                    mode={checked ? "elevated" : "mono"}
                    aria-pressed={checked}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Chip>
                );
              })}
            </div>
            <div className="FormField">
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
        </Section>

        {validationError && (
          <p ref={errorRef} className="FormError" role="alert">
            {validationError}
          </p>
        )}
        <MutationError error={create.error} />
      </div>
    </>
  );
}
