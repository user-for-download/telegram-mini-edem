import { useCallback, useRef, useState } from "react";
import { Caption, Input } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { HINT, INFO, PROSE } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";

import { Car, Hash, Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiError, isAccountDeletedError } from "@/api/client";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { MIN_TARGET } from "@/ui/classes";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { haptic } from "@/utils/haptics";
import { QueryState } from "@/components/QueryState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Stack } from "@/ui/Stack";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import {
  useRemoveVehicleMutation,
  useUpsertVehicleMutation,
  useVehicleQuery,
} from "@/queries/vehicle";
import {
  VEHICLE_LIMITS,
  normalizeVehicleForm,
  validateVehicleForm,
  vehicleRemoveErrorMessage,
  vehicleServerErrorMessage,
  type VehicleFieldError,
} from "./vehicleValidation";

type Vehicle = NonNullable<ReturnType<typeof useVehicleQuery>["vehicle"]>;

/**
 * Автомобиль водителя — route-backed шторка (роут /vehicle остаётся источником правды, вход из
 * ProfilePage тем же navigate("/vehicle") — см. VehicleRoute).
 */
export function VehicleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Имя диалога для скринридера + видимый заголовок на base-платформе
  // (tgui Modal.Header рисует текст только на iOS).
  return (
    <Sheet open={open} onClose={onClose} title="Автомобиль">
      <VehicleBody onDone={onClose} />
    </Sheet>
  );
}

/**
 * Роут /vehicle: фон — «Профиль» (точка входа), поверх — шторка. Фон
 * ОТКРЫТЫЙ, как в SettingsRoute: затемнение приезжает из китового Modal
 * и перехватывает указатель, так что профиль под шторкой не кликается и
 * не скроллится, а контекст «откуда пришли» сохраняется. Раньше здесь был
 * `<div aria-hidden hidden>`, но это выкидывало фон из дерева доступности
 * и оставляло под шторкой пустоту — хуже, чем профиль под затемнением.
 * Контент тестируется через VehicleBody (портал Modal в renderToString
 * не попадает). Закрытие — назад по истории, иначе fallback на /profile.
 */
export function VehicleRoute() {
  const navigate = useNavigate();
  const close = useCallback(() => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  }, [navigate]);
  return (
    <>
      <ProfilePage />
      <VehicleModal open onClose={close} />
    </>
  );
}

/** Терминальный экран бана/удаления mid-session (паттерн ProfilePage:
 * 403 от requireUser → Placeholder вместо общей ошибки). */
function VehicleTerminal({ deleted }: { deleted: boolean }) {
  return (
    <Notice role="alert" tone="danger" variant="text">
      {deleted
        ? "Профиль удалён — данные автомобиля недоступны."
        : "Действие недоступно: аккаунт заблокирован."}
    </Notice>
  );
}

/**
 * Тело модалки (экспортировано для SSR-тестов): форма сразу, без
 * промежуточного экрана с кнопкой. PageHeader с back-кнопкой
 * намеренно отсутствует — закрытие через header модалки / Esc / Back.
 */
export function VehicleBody({ onDone }: { onDone: () => void }) {
  const vehicleQuery = useVehicleQuery();
  const vehicle = vehicleQuery.vehicle ?? null;
  const remove = useRemoveVehicleMutation();
  if (
    vehicleQuery.error instanceof ApiError &&
    vehicleQuery.error.status === 403
  ) {
    return (
      <VehicleTerminal deleted={isAccountDeletedError(vehicleQuery.error)} />
    );
  }
  return (
    <QueryState
      loading={vehicleQuery.isLoading}
      error={vehicleQuery.error}
      empty={!vehicleQuery.data}
      emptyText={EMPTY_STATES.vehicleEmpty.description}
      onRetry={() => void vehicleQuery.refetch()}
    >
      {vehicleQuery.data && (
        // Тело окна прямо на фоне шторки, без Card: карточка внутри шторки —
        // вложенная поверхность, которой нет ни в одном другом окне (жалоба,
        // обращение, правка профиля, «Ищу попутку»). Раскладку даёт ui/Stack —
        // локальный .card был его копией.
        <Stack>
          {!vehicle && (
            <Caption Component="p" className={PROSE}>
              Чтобы публиковать поездки, добавьте автомобиль.
            </Caption>
          )}
          {/* key по наличию автомобиля: после удаления useRemoveVehicleMutation
              пишет пользователя без машины в общий кэш ["users","me"], `vehicle`
              становится null, но VehicleForm без key НЕ перемонтируется и
              продолжает держать удалённые значения в полях. Последствия были
              реальными: «Сохранить» молча создавал только что удалённую машину,
              а useClosingConfirmation сравнивал поля с пустым автомобилем и
              спрашивал «отменить изменения?» при ВЫХОДЕ из приложения.
              Тот же приём, что key={profile.data?.id} в EditProfileModal. */}
          <VehicleForm
            key={vehicle ? "has-vehicle" : "no-vehicle"}
            vehicle={vehicle}
            onDone={onDone}
          />
          {vehicle && (
            <>
              <ConfirmPopup
                nested
                label="Удалить автомобиль"
                confirmLabel="Да, удалить"
                description="Автомобиль будет удалён из профиля. Без него нельзя создавать новые поездки. При активных поездках удаление заблокировано."
                pending={remove.isPending}
                destructive
                className={MIN_TARGET}
                onConfirm={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => haptic.success(),
                    onError: () => haptic.error(),
                  })
                }
              />
              {remove.isError && (
                <Notice tone="danger" variant="text">
                  {vehicleRemoveErrorMessage(remove.error)}
                </Notice>
              )}
            </>
          )}
        </Stack>
      )}
    </QueryState>
  );
}

/** Добавление/редактирование через POST /users/me/car (лимиты — vehicleValidation). */
function VehicleForm({
  vehicle,
  onDone,
}: {
  vehicle: Vehicle | null;
  onDone: () => void;
}) {
  const upsert = useUpsertVehicleMutation();
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [color, setColor] = useState(vehicle?.color ?? "");
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  // Хранится id поля, а не текст: <Field error=…> сам ставит aria-invalid и
  // aria-describedby.
  const [fieldError, setFieldError] = useState<VehicleFieldError | null>(null);
  const errorFor = (id: string) =>
    fieldError?.field === id ? fieldError.message : undefined;
  useClosingConfirmation(
    model !== (vehicle?.model ?? "") ||
      color !== (vehicle?.color ?? "") ||
      plate !== (vehicle?.plate ?? ""),
  );
  const isSubmittingRef = useRef(false);
  const save = () => {
    if (isSubmittingRef.current) return;
    const error = validateVehicleForm(model, color, plate);
    if (error) {
      setFieldError(error);
      return;
    }
    setFieldError(null);
    isSubmittingRef.current = true;
    upsert.mutate(normalizeVehicleForm(model, color, plate), {
      onSuccess: () => {
        haptic.success();
        onDone();
      },
      onError: () => haptic.error(),
      onSettled: () => {
        isSubmittingRef.current = false;
      },
    });
  };
  return (
    <>
      <Field
        label="Модель"
        id="vehicle-model"
        error={errorFor("vehicle-model")}
      >
        {(field) => (
          <Input
            {...field}
            before={<Car size={17} className={INFO} />}
            value={model}
            maxLength={VEHICLE_LIMITS.model}
            placeholder="Skoda Octavia"
            onChange={(e) => {
              setModel(e.target.value.slice(0, VEHICLE_LIMITS.model));
              setFieldError(null);
            }}
          />
        )}
      </Field>
      <Field label="Цвет" id="vehicle-color" error={errorFor("vehicle-color")}>
        {(field) => (
          <Input
            {...field}
            before={<Palette size={16} className={HINT} />}
            value={color}
            maxLength={VEHICLE_LIMITS.color}
            placeholder="белый"
            onChange={(e) => {
              setColor(e.target.value.slice(0, VEHICLE_LIMITS.color));
              setFieldError(null);
            }}
          />
        )}
      </Field>
      <Field
        label="Номер (необязательно)"
        id="vehicle-plate"
        error={errorFor("vehicle-plate")}
      >
        {(field) => (
          <Input
            {...field}
            before={<Hash size={16} className={HINT} />}
            value={plate}
            maxLength={VEHICLE_LIMITS.plate}
            placeholder="Например: 583"
            onChange={(e) => {
              setPlate(
                e.target.value.toUpperCase().slice(0, VEHICLE_LIMITS.plate),
              );
              setFieldError(null);
            }}
          />
        )}
      </Field>
      <Caption Component="p" className={PROSE}>
        Номер — примета для узнавания, видна только вам. Чтобы убрать номер,
        очистите поле и сохраните.
      </Caption>
      {upsert.error && (
        <Notice tone="danger" variant="text">
          {vehicleServerErrorMessage(upsert.error)}
        </Notice>
      )}
      <Button
        stretched
        size="l"
        variant="primary"
        loading={upsert.isPending}
        // Кит у `loading` только вешает класс и спиннер — кнопка остаётся
        // и фокусируемой, и активной. Гасим её явно, иначе состояние
        // «сохраняется» видно только глазом.
        disabled={upsert.isPending}
        onClick={save}
      >
        Сохранить автомобиль
      </Button>
      <Button
        stretched
        disabled={upsert.isPending}
        onClick={() => {
          setFieldError(null);
          upsert.reset();
          onDone();
        }}
      >
        Отмена
      </Button>
    </>
  );
}
