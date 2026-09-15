import { useRef, useState } from "react";
import {
  Button,
  Chip,
  IconButton,
  Input,
  Placeholder,
  Section,
  Spinner,
  Textarea,
} from "@telegram-apps/telegram-ui";
import {
  ArrowRightLeft,
  Calendar,
  Clock,
  MapPin,
  Minus,
  Navigation,
  Plus,
  RussianRuble,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MutationError } from "@/components/MutationError";
import { CityPickerField } from "@/components/CityPickerField";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ToastProvider";
import { TRIP_TAGS } from "@/consts/tags";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useBottomBarAction } from "@/hooks/useBottomBarAction";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useCreateTripMutation } from "@/queries/useTripsQuery";
import { useVehicleQuery } from "@/queries/vehicle";
import { validateCreateTripDraft } from "@/helpers/createTripForm";
import { MAX_SEATS, type TripTag } from "@edem/contracts";

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

/** Текст ошибки под полем (виден рядом с красной подсветкой, не внизу страницы). */
function FieldError({ show, children }: { show: boolean; children: string | null }) {
  if (!show || !children) return null;
  return (
    <p className="FieldError" role="alert">
      {children}
    </p>
  );
}

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
  const navigate = useNavigate();
  const cities = useAllCitiesQuery();
  const create = useCreateTripMutation();
  const vehicleQuery = useVehicleQuery();
  const hasCar = (vehicleQuery.vehicle ?? null) !== null;
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
  /** id невалидного поля для status="error" и скролла (валидатор отдаёт field). */
  const [errorField, setErrorField] = useState<string | null>(null);
  /** Якорь блока ошибок: fallback скролла, когда field нет (общая ошибка). */
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  /** Правка гасит ошибку: текст больше не актуален, подсветка снимается. */
  const touch = () => {
    setValidationError(null);
    setErrorField(null);
  };

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
    touch();
    setFrom(to);
    setTo(from);
    setFromAddress(toAddress);
    setToAddress(fromAddress);
  };

  const toggleTag = (tag: TripTag) => {
    haptic.selection();
    touch();
    setTags((prev) =>
      prev.includes(tag)
        ? prev.filter((item) => item !== tag)
        : [...prev, tag].slice(0, 6),
    );
  };

  /** Степпер мест: целое 1..MAX_SEATS, ручной ввод исключён. */
  const stepSeats = (delta: 1 | -1) => () => {
    haptic.selection();
    touch();
    setSeats((prev) => {
      const next = Number(prev);
      const base = Number.isFinite(next) ? Math.trunc(next) : 1;
      return String(Math.min(MAX_SEATS, Math.max(1, base + delta)));
    });
  };

  /** Скролл к невалидному полю, иначе — к блоку общей ошибки. */
  const scrollToError = (field: string | null) => {
    if (field) {
      document.getElementById(field)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const submit = () => {
    setValidationError(null);
    setErrorField(null);
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
      setErrorField(validation.field);
      scrollToError(validation.field);
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
        scrollToError(null);
      },
    });
  };

  // CTA живёт в нижнем баре (Shell): loading напрямую из мутации.
  useBottomBarAction(
    hasCar
      ? {
        label: "Опубликовать",
        onSubmit: submit,
        loading: create.isPending,
        disabled: false,
      }
      : null,
  );

  if (cities.isLoading || vehicleQuery.isLoading) {
    return (
      <Placeholder>
        <Spinner size="m" />
        <>Загружаем города…</>
      </Placeholder>
    );
  }

  // Без автомобиля публиковать нельзя — сервер ответил бы 400 NO_CAR
  // после заполнения всей формы. Показываем гейт сразу, с дорогой в профиль.
  if (!vehicleQuery.error && !hasCar) {
    return (
      <>
        <OfflineBanner />
        <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
          <Section header="Нужен автомобиль">
            <div className="flex flex-col gap-3 p-4">
              <p className="text-[13px] text-(--tgui--hint_color) leading-relaxed">
                Чтобы публиковать поездки, сначала добавьте автомобиль в профиле.
              </p>
              <Button
                mode="filled"
                size="l"
                stretched
                onClick={() => {
                  haptic.light();
                  navigate("/vehicle");
                }}
              >
                Добавить автомобиль
              </Button>
            </div>
          </Section>
        </div>
      </>
    );
  }

  return (
    <>
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
        <Section header="Маршрут">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1.5 relative">
              <CityPickerField
                id="create-from"
                label="Город отправления"
                value={from}
                cities={cities.data}
                placeholder="Откуда едем — начните вводить"
                status={errorField === "create-from" ? "error" : "default"}
                onSelect={(name) => {
                  touch();
                  setFrom(name);
                }}
              />
              <FieldError show={errorField === "create-from"}>{validationError}</FieldError>
              <CityPickerField
                id="create-to"
                label="Город назначения"
                value={to}
                cities={cities.data}
                placeholder="Куда едем — начните вводить"
                status={errorField === "create-to" ? "error" : "default"}
                onSelect={(name) => {
                  touch();
                  setTo(name);
                }}
              />
              <FieldError show={errorField === "create-to"}>{validationError}</FieldError>
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
                status={errorField === "create-from-address" ? "error" : "default"}
                onChange={(event) => {
                  touch();
                  setFromAddress(event.target.value);
                }}
                placeholder="Точка встречи"
              />
              <FieldError show={errorField === "create-from-address"}>{validationError}</FieldError>
            </div>
            <div className="FormField">
              <label htmlFor="create-to-address">Адрес назначения</label>
              <Input
                id="create-to-address"
                before={<Navigation size={16} className="text-(--tgui--hint_color)" />}
                value={toAddress}
                status={errorField === "create-to-address" ? "error" : "default"}
                onChange={(event) => {
                  touch();
                  setToAddress(event.target.value);
                }}
                placeholder="Точка прибытия"
              />
              <FieldError show={errorField === "create-to-address"}>{validationError}</FieldError>
            </div>
          </div>
        </Section>

        <Section header="Поездка">
          <div className="flex flex-col gap-3 p-4">
              <div className="FormField">
                <label htmlFor="create-date">Дата и время</label>
                <Input
                  id="create-date"
                  before={<Calendar size={16} className="text-(--tgui--hint_color)" />}
                  type="datetime-local"
                  value={date}
                  status={errorField === "create-date" ? "error" : "default"}
                  onChange={(event) => {
                    touch();
                    setDate(event.target.value);
                  }}
                />
                <FieldError show={errorField === "create-date"}>{validationError}</FieldError>
              </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="FormField">
                <label htmlFor="create-price">Цена, ₽</label>
                <Input
                  id="create-price"
                  before={<RussianRuble size={16} className="text-(--tgui--hint_color)" />}
                  type="number"
                  min="1"
                  max="100000"
                  value={price}
                  status={errorField === "create-price" ? "error" : "default"}
                  onChange={(event) => {
                    touch();
                    setPrice(event.target.value);
                  }}
                />
                <FieldError show={errorField === "create-price"}>{validationError}</FieldError>
              </div>
              <fieldset className="FormField">
                <legend>Места</legend>
                <div
                  id="create-seats"
                  role="group"
                  aria-label={`Количество мест: ${seats} из ${MAX_SEATS}`}
                  className="flex max-w-6/7 items-center gap-2"
                >
                  <IconButton
                    type="button"
                    size="s"
                    mode="bezeled"
                    onClick={stepSeats(-1)}
                    disabled={Number(seats) <= 1}
                    aria-label="Меньше мест"
                  >
                    <Minus size={16} />
                  </IconButton>
                  <output
                    aria-live="polite"
                    aria-label="Выбрано мест"
                    className="flex-1 text-center text-[17px] font-bold text-(--tgui--text_color)"
                  >
                    {seats}
                  </output>
                  <IconButton
                    type="button"
                    size="s"
                    mode="bezeled"
                    onClick={stepSeats(1)}
                    disabled={Number(seats) >= MAX_SEATS}
                    aria-label="Больше мест"
                  >
                    <Plus size={16} />
                  </IconButton>
                </div>
                <FieldError show={errorField === "create-seats"}>{validationError}</FieldError>
              </fieldset>
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
                  status={errorField === "create-distance" ? "error" : "default"}
                  onChange={(event) => {
                    touch();
                    setDistanceKm(event.target.value);
                  }}
                  placeholder="180"
                />
                <FieldError show={errorField === "create-distance"}>{validationError}</FieldError>
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
                  status={errorField === "create-duration" ? "error" : "default"}
                  onChange={(event) => {
                    touch();
                    setDurationHours(event.target.value);
                  }}
                />
                <FieldError show={errorField === "create-duration"}>{validationError}</FieldError>
              </div>
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
              status={errorField === "create-comment" ? "error" : "default"}
              onChange={(event) => {
                touch();
                setComment(event.target.value);
              }}
            />
            <FieldError show={errorField === "create-comment"}>{validationError}</FieldError>
            </div>
          </div>
        </Section>

        {validationError && !errorField && (
          <p ref={errorRef} className="FormError" role="alert">
            {validationError}
          </p>
        )}
        <MutationError error={create.error} />
      </div>
    </>
  );
}
