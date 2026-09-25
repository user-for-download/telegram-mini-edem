import { useEffect, useRef, useState } from "react";
import {
  Caption,
  Input,
  Section,
  Text,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { BTN_ROW_WRAP, HINT, INFO, PROSE } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { FieldError } from "@/ui/FieldError";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { IconButton } from "@/ui/IconButton";
import { Loading } from "@/ui/Loading";

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
import { CityPickerField } from "@/components/CityPicker/CityPickerField";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useToast } from "@/components/Toast/ToastProvider";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { TRIP_TAGS } from "@/consts/tags";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useModalBack } from "@/utils/modalBack";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useCreateTripMutation } from "@/queries/useTripsQuery";
import { useVehicleQuery } from "@/queries/vehicle";
import { VehicleModal } from "@/components/Profile/VehicleModal";
import { validateCreateTripDraft } from "@/helpers/createTripForm";
import { MAX_SEATS, type TripTag } from "@edem/contracts";
import styles from "./CreateTripPage.module.css";

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

/**
 * Создание поездки — отдельная страница (роут /trips/my/new).
 *
 * Почему не модалка: форма из 10+ полей в шторке с внутренним скроллом
 * (max-h 82dvh) неудобна — клавиатура перекрывает поля, CTA уезжает,
 * свайп-закрытие конфликтует со скроллом. На странице — естественный
 * скролл WebView, нативный BackButton (Shell показывает его на
 * некорневых роутах), CTA — кнопка «Опубликовать» инлайн в конце формы
 * (как «Забронировать» в деталях поездки).
 *
 * Поверхности — нативные Section, города — Select из справочника
 * (datalist в WebView не даёт нативного пикера), теги — Chip
 * (паритет поиска/редактирования), валидация — createTripDtoSchema.
 */
export function CreateTripPage() {
  const navigate = useNavigate();
  return (
    <CreateTripForm
      onCreated={(tripId) => navigate(`/trips/${tripId}`, { replace: true })}
    />
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
  const vehicleQuery = useVehicleQuery({ refetchOnMount: "always" });
  const hasCar = (vehicleQuery.vehicle ?? null) !== null;
  // Гейт решает по свежим данным: refetch идёт при каждом монтировании
  // (кэш профиля мог устареть — авто добавлено мимо app-flow/e2e-sql).
  const vehicleChecking = vehicleQuery.isLoading || vehicleQuery.isFetching;
  // Нет авто — сразу шторка VehicleModal поверх гейта (без промежуточной
  // навигации на /vehicle): форма авто короткая (3 поля), возврат — сюда же,
  // кэш ["users","me"] после сохранения сам переключит hasCar.
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const vehicleAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (
      !vehicleChecking &&
      !hasCar &&
      !vehicleAutoOpenedRef.current
    ) {
      vehicleAutoOpenedRef.current = true;
      setVehicleOpen(true);
    }
  }, [vehicleChecking, hasCar]);
  const closeVehicle = () => setVehicleOpen(false);
  useModalBack(closeVehicle, vehicleOpen);
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
  // Сравниваем с начальными значениями (см. useState выше): любое
  // отклонение — черновик.
  useClosingConfirmation(
    from !== "" ||
      to !== "" ||
      fromAddress !== "" ||
      toAddress !== "" ||
      date !== tomorrow().slice(0, 16) ||
      durationHours !== "1" ||
      distanceKm !== "" ||
      price !== "500" ||
      seats !== "1" ||
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
      document
        .getElementById(field)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
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

  if (cities.isLoading || vehicleChecking) {
    return <Loading label="Загружаем города…" />;
  }

  // Без автомобиля публиковать нельзя — сервер ответил бы 400 NO_CAR
  // после заполнения всей формы. Показываем гейт сразу, с дорогой в профиль.
  if (!vehicleQuery.error && !hasCar) {
    return (
      <>
        <OfflineBanner />
        <Page>
          <Section header="Нужен автомобиль">
            <SectionBody>
              <Caption Component="p" className={PROSE}>
                Чтобы публиковать поездки, добавьте автомобиль — откроется окно с тремя полями.
              </Caption>
              <Button
                variant="primary"
                size="l"
                stretched
                onClick={() => {
                  haptic.light();
                  setVehicleOpen(true);
                }}
              >
                Добавить автомобиль
              </Button>
            </SectionBody>
          </Section>
        </Page>
        <VehicleModal open={vehicleOpen} onClose={closeVehicle} />
      </>
    );
  }

  return (
    <>
      <OfflineBanner />
      <Page>
        <Section header="Маршрут">
          <SectionBody>
            <div className={styles.cityFields}>
              <CityPickerField
                id="create-from"
                label="Город отправления"
                value={from}
                cities={cities.data}
                placeholder="Откуда едем — начните вводить"
                status={errorField === "create-from" ? "error" : undefined}
                onSelect={(name) => {
                  touch();
                  setFrom(name);
                }}
              />
              <FieldError
                error={errorField === "create-from" ? validationError : null}
              />
              <CityPickerField
                id="create-to"
                label="Город назначения"
                value={to}
                cities={cities.data}
                placeholder="Куда едем — начните вводить"
                status={errorField === "create-to" ? "error" : undefined}
                onSelect={(name) => {
                  touch();
                  setTo(name);
                }}
              />
              <FieldError
                error={errorField === "create-to" ? validationError : null}
              />
              <IconButton
                type="button"
                size="s"
                onClick={swapCities}
                aria-label="Поменять направление"
                className={styles.swap}
              >
                <ArrowRightLeft size={14} className={INFO} />
              </IconButton>
            </div>
            <Field label="Адрес отправления" id="create-from-address">
              {(field) => (
                <>
                  <Input
                    {...field}
                    before={
                      <Navigation size={16} className={HINT} />
                    }
                    value={fromAddress}
                    status={
                      errorField === "create-from-address" ? "error" : undefined
                    }
                    onChange={(event) => {
                      touch();
                      setFromAddress(event.target.value);
                    }}
                    placeholder="Точка встречи"
                  />
                  <FieldError
                    error={
                      errorField === "create-from-address"
                        ? validationError
                        : null
                    }
                  />
                </>
              )}
            </Field>
            <Field label="Адрес назначения" id="create-to-address">
              {(field) => (
                <>
                  <Input
                    {...field}
                    before={
                      <Navigation size={16} className={HINT} />
                    }
                    value={toAddress}
                    status={
                      errorField === "create-to-address" ? "error" : undefined
                    }
                    onChange={(event) => {
                      touch();
                      setToAddress(event.target.value);
                    }}
                    placeholder="Точка прибытия"
                  />
                  <FieldError
                    error={
                      errorField === "create-to-address"
                        ? validationError
                        : null
                    }
                  />
                </>
              )}
            </Field>
          </SectionBody>
        </Section>

        <Section header="Поездка">
          <SectionBody>
            <Field label="Дата и время" id="create-date">
              {(field) => (
                <>
                  <Input
                    {...field}
                    before={<Calendar size={16} className={HINT} />}
                    type="datetime-local"
                    value={date}
                    status={errorField === "create-date" ? "error" : undefined}
                    onChange={(event) => {
                      touch();
                      setDate(event.target.value);
                    }}
                  />
                  <FieldError
                    error={
                      errorField === "create-date" ? validationError : null
                    }
                  />
                </>
              )}
            </Field>
            <div className={styles.grid2}>
              <Field label="Цена, ₽" id="create-price">
                {(field) => (
                  <>
                    <Input
                      {...field}
                      before={
                        <RussianRuble size={16} className={HINT} />
                      }
                      type="number"
                      min="1"
                      max="100000"
                      value={price}
                      status={
                        errorField === "create-price" ? "error" : undefined
                      }
                      onChange={(event) => {
                        touch();
                        setPrice(event.target.value);
                      }}
                    />
                    <FieldError
                      error={
                        errorField === "create-price" ? validationError : null
                      }
                    />
                  </>
                )}
              </Field>
              <fieldset>
                <legend>Места</legend>
                <div
                  id="create-seats"
                  role="group"
                  aria-label={`Количество мест: ${seats} из ${MAX_SEATS}`}
                  className={styles.stepper}
                >
                  <IconButton
                    type="button"
                    size="s"
                    variant="secondary"
                    onClick={stepSeats(-1)}
                    disabled={Number(seats) <= 1}
                    aria-label="Меньше мест"
                  >
                    <Minus size={16} />
                  </IconButton>
                  <Text
                    weight="2"
                    Component="output"
                    aria-live="polite"
                    aria-label="Выбрано мест"
                    className={styles.stepperValue}
                  >
                    {seats}
                  </Text>
                  <IconButton
                    type="button"
                    size="s"
                    variant="secondary"
                    onClick={stepSeats(1)}
                    disabled={Number(seats) >= MAX_SEATS}
                    aria-label="Больше мест"
                  >
                    <Plus size={16} />
                  </IconButton>
                </div>
                <FieldError
                  error={errorField === "create-seats" ? validationError : null}
                />
              </fieldset>
            </div>
            <div className={styles.grid2}>
              <Field label="Расстояние, км" id="create-distance">
                {(field) => (
                  <>
                    <Input
                      {...field}
                      before={<MapPin size={16} className={HINT} />}
                      type="number"
                      min="1"
                      max="20000"
                      value={distanceKm}
                      status={
                        errorField === "create-distance" ? "error" : undefined
                      }
                      onChange={(event) => {
                        touch();
                        setDistanceKm(event.target.value);
                      }}
                      placeholder="180"
                    />
                    <FieldError
                      error={
                        errorField === "create-distance"
                          ? validationError
                          : null
                      }
                    />
                  </>
                )}
              </Field>
              <Field label="В пути, часов" id="create-duration">
                {(field) => (
                  <>
                    <Input
                      {...field}
                      before={<Clock size={16} className={HINT} />}
                      type="number"
                      min="1"
                      max="168"
                      value={durationHours}
                      status={
                        errorField === "create-duration" ? "error" : undefined
                      }
                      onChange={(event) => {
                        touch();
                        setDurationHours(event.target.value);
                      }}
                    />
                    <FieldError
                      error={
                        errorField === "create-duration"
                          ? validationError
                          : null
                      }
                    />
                  </>
                )}
              </Field>
            </div>
          </SectionBody>
        </Section>

        <Section
          header="Условия поездки"
          footer={`до 6 · выбрано ${tags.length}`}
        >
          <SectionBody>
            <div
              className={BTN_ROW_WRAP}
              role="group"
              aria-label="Условия поездки"
            >
              {TRIP_TAGS.map((tag) => {
                const checked = tags.includes(tag);
                return (
                  <Chip
                    key={tag}
                    tone="accent"
                    Component="button"
                    type="button"
                    variant={checked ? "active" : "quiet"}
                    aria-pressed={checked}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Chip>
                );
              })}
            </div>
            <div>
              <label htmlFor="create-comment">Комментарий</label>
              <Textarea
                id="create-comment"
                rows={3}
                maxLength={500}
                placeholder="Например: едем спокойно, салон чистый, багажник свободен"
                value={comment}
                status={errorField === "create-comment" ? "error" : undefined}
                onChange={(event) => {
                  touch();
                  setComment(event.target.value);
                }}
              />
              <FieldError
                error={errorField === "create-comment" ? validationError : null}
              />
            </div>
          </SectionBody>
        </Section>

        {validationError && !errorField && (
          <Notice tone="danger" variant="text" ref={errorRef}>
            {validationError}
          </Notice>
        )}
        <MutationError error={create.error} />
        <Button
          variant="primary"
          size="l"
          stretched
          loading={create.isPending}
          disabled={create.isPending}
          onClick={submit}
        >
          Опубликовать
        </Button>
      </Page>
    </>
  );
}
