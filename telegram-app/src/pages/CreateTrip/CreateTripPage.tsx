import { useEffect, useRef, useState } from "react";
import {
  Caption,
  Input,
  Select,
  Textarea,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { Section } from "@/ui/Section";
import { BTN_ROW_WRAP, HINT, INFO, PROSE } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { QueryState } from "@/components/QueryState";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { IconButton } from "@/ui/IconButton";
import { Loading } from "@/ui/Loading";

import {
  ArrowRightLeft,
  Calendar,
  Clock,
  MapPin,
  Navigation,
  RussianRuble,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MutationError } from "@/components/MutationError";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";
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
import { useTripForm } from "./useTripForm";
import { MAX_SEATS, type TripTag } from "@edem/contracts";
import styles from "./CreateTripPage.module.css";

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
    // Только когда мы УВЕРЕНЫ, что авто нет. При ошибке /users/me
    // автомобиль неизвестен (не «отсутствует»), и авто-открытие модалки
    // было бы враньём: ветка-ошибка VehicleModal не рендерит.
    if (
      !vehicleChecking &&
      !vehicleQuery.error &&
      !hasCar &&
      !vehicleAutoOpenedRef.current
    ) {
      vehicleAutoOpenedRef.current = true;
      setVehicleOpen(true);
    }
  }, [vehicleChecking, vehicleQuery.error, hasCar]);
  const closeVehicle = () => setVehicleOpen(false);
  useModalBack(closeVehicle, vehicleOpen);
  // Поля формы — в useTripForm (useReducer + isDirty); UI-флаги ниже —
  // в useState.
  const {
    form: {
      fromCityId,
      toCityId,
      fromAddress,
      toAddress,
      date,
      durationHours,
      distanceKm,
      price,
      seats,
      comment,
      tags,
    },
    draft,
    isDirty,
    setField,
    swapCities: swapFormCities,
    toggleTag: toggleFormTag,
  } = useTripForm();
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

  /** id поля → текст ошибки только для этого поля (фасад Field сам её привязывает). */
  const errorFor = (id: string): string | null =>
    errorField === id ? validationError : null;
  /** id поля → status="error" только для этого поля. */
  const statusFor = (id: string): "error" | undefined =>
    errorField === id ? "error" : undefined;

  // Несохранённый черновик — Telegram спросит подтверждение закрытия.
  // isDirty сравнивает форму с начальными значениями (см. useTripForm):
  // любое отклонение — черновик.
  useClosingConfirmation(isDirty);

  const swapCities = () => {
    haptic.selection();
    touch();
    swapFormCities();
  };

  const toggleTag = (tag: TripTag) => {
    haptic.selection();
    touch();
    toggleFormTag(tag);
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
    const validation = validateCreateTripDraft(draft, cities.data);
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
    // Page variant="hero" — без него Placeholder из Loading стоит сверху.
    // Подпись честно называет ОБА ожидания: список городов и проверку автомобиля.
    return (
      <Page variant="hero">
        <Loading label="Загружаем форму…" />
      </Page>
    );
  }

  // Ошибка справочника — отдельный терминальный экран: сетевая ошибка
  // справочника не ошибка валидации, иначе форма висит в загрузке, а
  // submit сообщает «Выберите города из справочника» вместо
  // «сервис недоступен».
  if (cities.isError) {
    return (
      <Page variant="hero">
        <QueryState
          loading={false}
          error={cities.error}
          empty={false}
          emptyText=""
          onRetry={() => void cities.refetch()}
        >
          {null}
        </QueryState>
      </Page>
    );
  }

  // Сбой профиля — авто НЕИЗВЕСТНО, а не отсутствует: ошибка профиля —
  // отдельный терминальный экран с повтором, а форма при неизвестном
  // автомобиле не рендерится вовсе (иначе публикация гарантированно
  // падала бы на сервере с NO_CAR без выхода из тупика).
  if (vehicleQuery.error) {
    return (
      <Page variant="hero">
        <QueryState
          loading={false}
          error={vehicleQuery.error}
          empty={false}
          emptyText=""
          onRetry={() => void vehicleQuery.refetch()}
        >
          {null}
        </QueryState>
      </Page>
    );
  }

  // Без автомобиля публиковать нельзя — сервер ответил бы 400 NO_CAR
  // после заполнения всей формы. Показываем гейт сразу, с дорогой в профиль.
  if (!hasCar) {
    return (
      <>
        <Page>
          <Section header="Нужен автомобиль">
            <SectionBody>
              <Caption Component="p" className={PROSE}>
                Чтобы публиковать поездки, добавьте автомобиль — откроется окно
                с тремя полями.
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
      <Page>
        {/* NavHeader помечен aria-hidden («авторитетные h1 живут на страницах»),
            поэтому имя экрана даёт скрытый h1, а заголовки секций — h2
            (гарантирует фасад ui/Section). */}
        <VisuallyHidden Component="h1">Создание поездки</VisuallyHidden>
        <Section header="Маршрут">
          <SectionBody>
            <div className={styles.cityFields}>
              {/* Тот же CitySelectField, что на главной и в поиске:
                  китовский Multiselect не подходит (реестр #19). */}
              <CitySelectField
                id="create-from"
                label="Город отправления"
                valueId={fromCityId}
                cities={cities.data}
                placeholder="Откуда едем"
                error={errorFor("create-from")}
                excludeId={toCityId}
                onChange={(next) => {
                  touch();
                  setField("fromCityId", next);
                }}
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
              <CitySelectField
                id="create-to"
                label="Город назначения"
                valueId={toCityId}
                cities={cities.data}
                placeholder="Куда едем"
                error={errorFor("create-to")}
                excludeId={fromCityId}
                onChange={(next) => {
                  touch();
                  setField("toCityId", next);
                }}
              />
            </div>
            <Field label="Адрес отправления" id="create-from-address" error={errorFor("create-from-address")}>
              {(field) => (
                <>
                  <Input
                    {...field}
                    before={<Navigation size={16} className={HINT} />}
                    value={fromAddress}
                    status={statusFor("create-from-address")}
                    onChange={(event) => {
                      touch();
                      setField("fromAddress", event.target.value);
                    }}
                    placeholder="Точка встречи"
                  />
                </>
              )}
            </Field>
            <Field label="Адрес назначения" id="create-to-address" error={errorFor("create-to-address")}>
              {(field) => (
                <>
                  <Input
                    {...field}
                    before={<Navigation size={16} className={HINT} />}
                    value={toAddress}
                    status={statusFor("create-to-address")}
                    onChange={(event) => {
                      touch();
                      setField("toAddress", event.target.value);
                    }}
                    placeholder="Точка прибытия"
                  />
                </>
              )}
            </Field>
          </SectionBody>
        </Section>

        <Section header="Поездка">
          <SectionBody>
            <Field label="Дата и время" id="create-date" error={errorFor("create-date")}>
              {(field) => (
                <>
                  <Input
                    {...field}
                    before={<Calendar size={16} className={HINT} />}
                    type="datetime-local"
                    value={date}
                    status={statusFor("create-date")}
                    onChange={(event) => {
                      touch();
                      setField("date", event.target.value);
                    }}
                  />
                </>
              )}
            </Field>
            <div className={styles.grid2}>
              <Field label="Цена, ₽" id="create-price" error={errorFor("create-price")}>
                {(field) => (
                  <>
                    <Input
                      {...field}
                      before={<RussianRuble size={16} className={HINT} />}
                      type="number"
                      min="1"
                      max="100000"
                      value={price}
                      status={statusFor("create-price")}
                      onChange={(event) => {
                        touch();
                        setField("price", event.target.value);
                      }}
                    />
                  </>
                )}
              </Field>
              <Field label="Места" id="create-seats" error={errorFor("create-seats")}>
                {(field) => (
                  <Select
                    {...field}
                    value={seats}
                    status={statusFor("create-seats")}
                    onChange={(event) => {
                      haptic.selection();
                      touch();
                      setField("seats", event.target.value);
                    }}
                  >
                    {Array.from({ length: MAX_SEATS }, (_, index) => (
                      <option key={index + 1} value={String(index + 1)}>
                        {index + 1}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className={styles.grid2}>
              <Field label="Расстояние, км" id="create-distance" error={errorFor("create-distance")}>
                {(field) => (
                  <>
                    <Input
                      {...field}
                      before={<MapPin size={16} className={HINT} />}
                      type="number"
                      min="1"
                      max="20000"
                      value={distanceKm}
                      status={statusFor("create-distance")}
                      onChange={(event) => {
                        touch();
                        setField("distanceKm", event.target.value);
                      }}
                      placeholder="180"
                    />
                  </>
                )}
              </Field>
              <Field label="В пути, часов" id="create-duration" error={errorFor("create-duration")}>
                {(field) => (
                  <>
                    <Input
                      {...field}
                      before={<Clock size={16} className={HINT} />}
                      type="number"
                      min="1"
                      max="168"
                      value={durationHours}
                      status={statusFor("create-duration")}
                      onChange={(event) => {
                        touch();
                        setField("durationHours", event.target.value);
                      }}
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
            <Field label="Комментарий" id="create-comment" error={errorFor("create-comment")}>
              {(field) => (
                <Textarea
                  {...field}
                  rows={3}
                  maxLength={500}
                  placeholder="Например: едем спокойно, салон чистый, багажник свободен"
                  value={comment}
                  status={statusFor("create-comment")}
                  onChange={(event) => {
                    touch();
                    setField("comment", event.target.value);
                  }}
                />
              )}
            </Field>
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
