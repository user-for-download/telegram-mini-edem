import { memo, useState } from "react";
import { Input, Text } from "@telegram-apps/telegram-ui";
import { Calendar, Users } from "lucide-react";
import { createRideRequestDtoSchema } from "@edem/contracts";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";
import { useToast } from "@/components/Toast/ToastProvider";
import { HINT } from "@/ui/classes";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useCreateRideRequestMutation } from "@/queries/useRideRequestsQuery";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { haptic } from "@/utils/haptics";
import {
  rideRequestErrorMessage,
  validateRideRequestWindow,
  type RideRequestFieldError,
} from "./rideRequestValidation";
import styles from "./TripModals.module.css";

/**
 * Форма создания заявки на попутку — «Новый запрос».
 *
 * Вынесена из бывшей шторки «Ищу попутку», где она делила тело со списком
 * заявок. Теперь форма — только содержимое всплывающего окна
 * (`RideRequestCreateModal`), а список живёт на странице истории.
 * Набор полей, id и тексты — без изменений.
 *
 * Состояние формы — здесь, а не в хосте окна: после успешной публикации
 * чистится только оно; хост про успех не знает (окно само не закрывается,
 * как и раньше — список за окном обновляется инвалидацией кэша
 * `["ride-requests"]`).
 */
export const RideRequestCreateForm = memo(function RideRequestCreateForm() {
  const cities = useAllCitiesQuery();
  const create = useCreateRideRequestMutation();
  const toast = useToast();
  // Города — id справочника: имя резолвится в id только при отправке —
  // тот же антипаттерн давал ложную ошибку «Выберите города из справочника».
  const [fromCityId, setFromCityId] = useState("");
  const [toCityId, setToCityId] = useState("");
  const [earliest, setEarliest] = useState("");
  const [latest, setLatest] = useState("");
  const [seats, setSeats] = useState("1");
  // Ошибка приходит с полем: <Field error=…> ставит aria-invalid и
  // aria-describedby. Zod-сообщения переводятся rideRequestErrorMessage.
  const [createError, setCreateError] = useState<RideRequestFieldError | null>(
    null,
  );
  const validationError = createError?.message ?? null;
  const createErrorFor = (id: string) =>
    createError?.field === id ? createError.message : undefined;
  const setValidationError = (message: string) =>
    setCreateError({ field: null, message });

  const submit = () => {
    const fromCity = cities.data?.find((city) => city.id === fromCityId);
    const toCity = cities.data?.find((city) => city.id === toCityId);
    if (!fromCity || !toCity) {
      setValidationError("Выберите города из справочника");
      return;
    }
    // Порядок окна — до схемы: zod отвечает английским message,
    // пользователю показываем русский текст.
    const windowError = validateRideRequestWindow(earliest, latest);
    if (windowError) {
      setValidationError(windowError);
      return;
    }
    const earliestDate = new Date(earliest);
    const latestDate = new Date(latest);
    if (fromCity.id === toCity.id) {
      setValidationError("Города отправления и прибытия должны различаться");
      return;
    }
    const parsed = createRideRequestDtoSchema.safeParse({
      fromCityId: fromCity.id,
      toCityId: toCity.id,
      earliestAt: earliestDate.toISOString(),
      latestAt: latestDate.toISOString(),
      // Запрос живёт до конца окна «Не позже»: привязка к earliest
      // гасила его из выдачи в момент начала окна.
      expiresAt: latestDate.toISOString(),
      seats: Number(seats),
    });
    if (!parsed.success) {
      setCreateError(
        rideRequestErrorMessage(parsed.error.issues[0]?.path ?? []),
      );
      return;
    }
    setCreateError(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        haptic.success();
        // Подтверждение — тостом, как после публикации поездки и прочих
        // действий (7 вызовов toast.show в приложении). Одной хаптики
        // мало: на iOS в WebView hapticFeedback может не сработать, а форма
        // просто очищается — без тоста непонятно, опубликовалось или нет.
        //
        // В историю НЕ уводим: окно открывается с главной, где за ним нет
        // списка, и переход сбрасывал бы контекст после трёх полей. Плюс
        // список за окном обновится сам — инвалидация ["ride-requests"].
        toast.show({
          text: "Запрос опубликован",
          description: `${fromCity.name} → ${toCity.name} — водители увидят его в поиске`,
        });
        setFromCityId("");
        setToCityId("");
        setEarliest("");
        setLatest("");
      },
      onError: () => haptic.error(),
    });
  };

  return (
    <Card className={styles.card}>
      <Text weight="2" Component="span">
        Новый запрос
      </Text>
      {/* Выбор города — тот же CitySelectField, что на главной, в поиске и
          форме создания. */}
      <CitySelectField
        id="ride-from"
        label="Откуда"
        valueId={fromCityId}
        cities={cities.data}
        placeholder="Город отправления"
        excludeId={toCityId}
        onChange={setFromCityId}
        error={createErrorFor("ride-from")}
      />
      <CitySelectField
        id="ride-to"
        label="Куда"
        valueId={toCityId}
        cities={cities.data}
        placeholder="Город назначения"
        excludeId={fromCityId}
        onChange={setToCityId}
        error={createErrorFor("ride-to")}
      />
      <div className={styles.grid2}>
        <Field
          label="Не раньше"
          id="ride-earliest"
          error={createErrorFor("ride-earliest")}
        >
          {(field) => (
            <Input
              {...field}
              before={<Calendar size={16} className={HINT} />}
              type="datetime-local"
              value={earliest}
              onChange={(event) => setEarliest(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Не позже"
          id="ride-latest"
          error={createErrorFor("ride-latest")}
        >
          {(field) => (
            <Input
              {...field}
              before={<Calendar size={16} className={HINT} />}
              type="datetime-local"
              value={latest}
              onChange={(event) => setLatest(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field
        label="Места"
        id="ride-seats"
        error={createErrorFor("ride-seats")}
      >
        {(field) => (
          <Input
            {...field}
            before={<Users size={16} className={HINT} />}
            type="number"
            min="1"
            max="3"
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
          />
        )}
      </Field>
      {/* Плашка только когда поле null: иначе текст уже нарисован
          самим <Field> и второй раз дублировался бы. */}
      {validationError && !createError?.field && (
        <Notice tone="danger" variant="text">
          {validationError}
        </Notice>
      )}
      {create.error && (
        <Notice tone="danger" variant="text">
          {bookingErrorMessage(create.error)}
        </Notice>
      )}
      <Button
        stretched
        size="l"
        loading={create.isPending}
        onClick={submit}
      >
        Опубликовать запрос
      </Button>
    </Card>
  );
});