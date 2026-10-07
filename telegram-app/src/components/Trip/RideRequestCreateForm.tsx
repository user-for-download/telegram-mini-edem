import { memo, useState } from "react";
import { Text } from "@telegram-apps/telegram-ui";
import { useToast } from "@/components/Toast/ToastProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useCreateRideRequestMutation } from "@/queries/useRideRequestsQuery";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { haptic } from "@/utils/haptics";
import { RideRequestFields } from "./RideRequestFields";
import { useMatchingTripCheck } from "./useMatchingTripCheck";
import {
  buildRideRequestDraft,
  EMPTY_RIDE_REQUEST_DRAFT,
  type RideRequestDraft,
  type RideRequestFieldError,
} from "./rideRequestValidation";
import type { CreateRideRequestDto } from "@edem/contracts";
import styles from "./TripModals.module.css";

/** Заглушка хоста без перехода: форма обязана работать и без навигатора. */
const NOOP_NAVIGATE = () => {};

/**
 * Форма создания заявки на попутку — тело всплывающего окна
 * (`RideRequestCreateModal`). Список заявок живёт на странице истории,
 * поэтому в форме его нет.
 *
 * Порядок публикации: валидация черновика → **предпроверка «уже есть
 * поездки»** → мутация. Проверка информирующая: поездки нашлись и человек
 * согласился — уходим в карточку, заявку не создавая; отказ, отсутствие
 * совпадений и сетевой сбой — заявка создаётся как раньше (решение
 * владельца, диалог не блокирует действие).
 *
 * Переход — инъекция (`onNavigate` от хоста окна): форма не знает роутера,
 * поэтому тестируется и рендерится в SSR без Router.
 */
export const RideRequestCreateForm = memo(function RideRequestCreateForm({
  onNavigate = NOOP_NAVIGATE,
}: {
  onNavigate?: (route: string) => void;
}) {
  const cities = useAllCitiesQuery();
  const create = useCreateRideRequestMutation();
  const toast = useToast();
  const checkTrip = useMatchingTripCheck(onNavigate);
  // Города — id справочника: имя резолвится в id только при отправке —
  // тот же антипаттерн давал ложную ошибку «Выберите города из справочника».
  const [values, setValues] = useState<RideRequestDraft>(
    EMPTY_RIDE_REQUEST_DRAFT,
  );
  const [createError, setCreateError] = useState<RideRequestFieldError | null>(
    null,
  );
  const errorFor = (id: string) =>
    createError?.field === id ? createError.message : undefined;
  // Плашка нужна только для общей ошибки (field === null): при поле ошибку
  // уже нарисовал сам <Field>, второй раз текст дублировался бы.
  const generalError =
    createError && !createError.field ? createError.message : null;

  /** Маршрут и окно чистим, выбранные места оставляем — как было. */
  const clear = () =>
    setValues((current) => ({
      ...current,
      fromCityId: "",
      toCityId: "",
      earliest: "",
      latest: "",
    }));

  const publish = (dto: CreateRideRequestDto, routeLabel: string) => {
    create.mutate(dto, {
      onSuccess: () => {
        haptic.success();
        // Подтверждение — тостом, как после публикации поездки и прочих
        // действий (7 вызовов toast.show в приложении). Одной хаптики мало:
        // на iOS в WebView hapticFeedback может не сработать, а форма просто
        // очищается — без тоста непонятно, опубликовалось или нет.
        //
        // В историю НЕ уводим: окно открывается с главной, где за ним нет
        // списка, и переход сбрасывал бы контекст после трёх полей. Плюс
        // список за окном обновится сам — инвалидация ["ride-requests"].
        toast.show({
          text: "Запрос опубликован",
          description: `${routeLabel} — водители увидят его в поиске`,
        });
        clear();
      },
      onError: () => haptic.error(),
    });
  };

  const submit = async () => {
    const draft = buildRideRequestDraft(values, cities.data);
    if (!draft.ok) {
      setCreateError(draft.error);
      return;
    }
    setCreateError(null);
    const proceed = await checkTrip(values, draft.routeLabel);
    if (!proceed) return;
    publish(draft.dto, draft.routeLabel);
  };

  return (
    <Card className={styles.card}>
      <Text weight="2" Component="span">
        Новый запрос
      </Text>
      <RideRequestFields
        cities={cities.data}
        values={values}
        errorFor={errorFor}
        onChange={setValues}
      />
      {generalError && (
        <Notice tone="danger" variant="text">
          {generalError}
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
        onClick={() => void submit()}
      >
        Опубликовать запрос
      </Button>
    </Card>
  );
});
