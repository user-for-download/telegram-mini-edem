import { useCallback, useRef, useState } from "react";
import { Caption, Input } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";

import { Car, Hash, Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { haptic } from "@/utils/haptics";
import { QueryState } from "@/components/QueryState";
import { Card } from "@/ui/Card";
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
} from "./vehicleValidation";
import styles from "./ProfileModals.module.css";

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
 * Роут /vehicle: фон — скрытый «Профиль», поверх — настоящая шторка.
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
      <div aria-hidden hidden>
        <ProfilePage />
      </div>
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
      <VehicleTerminal
        deleted={vehicleQuery.error.message === "Account is deleted"}
      />
    );
  }
  return (
    <QueryState
      loading={vehicleQuery.isLoading}
      error={vehicleQuery.error}
      empty={!vehicleQuery.data}
      emptyText="Не удалось загрузить автомобиль."
      onRetry={() => void vehicleQuery.refetch()}
    >
      {vehicleQuery.data && (
        <Card className={styles.card}>
          {!vehicle && (
            <Caption Component="p" className={styles.prose}>
              Чтобы публиковать поездки, добавьте автомобиль.
            </Caption>
          )}
          <VehicleForm vehicle={vehicle} onDone={onDone} />
          {vehicle && (
            <>
              <ConfirmPopup
                label="Удалить автомобиль"
                confirmLabel="Да, удалить"
                description="Автомобиль будет удалён из профиля. Без него нельзя создавать новые поездки. При активных поездках удаление заблокировано."
                pending={remove.isPending}
                destructive
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
        </Card>
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
  const [formError, setFormError] = useState<string | null>(null);
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
      setFormError(error);
      return;
    }
    setFormError(null);
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
      <Field label="Модель" id="vehicle-model">
        {(field) => (
          <Input
            {...field}
            before={<Car size={17} className={styles.info} />}
            value={model}
            maxLength={VEHICLE_LIMITS.model}
            placeholder="Skoda Octavia"
            onChange={(e) => {
              setModel(e.target.value.slice(0, VEHICLE_LIMITS.model));
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      <Field label="Цвет" id="vehicle-color">
        {(field) => (
          <Input
            {...field}
            before={<Palette size={16} className={styles.hint} />}
            value={color}
            maxLength={VEHICLE_LIMITS.color}
            placeholder="белый"
            onChange={(e) => {
              setColor(e.target.value.slice(0, VEHICLE_LIMITS.color));
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      <Field label="Номер (необязательно)" id="vehicle-plate">
        {(field) => (
          <Input
            {...field}
            before={<Hash size={16} className={styles.hint} />}
            value={plate}
            maxLength={VEHICLE_LIMITS.plate}
            placeholder="Например: 583"
            onChange={(e) => {
              setPlate(
                e.target.value.toUpperCase().slice(0, VEHICLE_LIMITS.plate),
              );
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      <Caption Component="p" className={styles.prose}>
        Номер — примета для узнавания, видна только вам. Чтобы убрать номер,
        очистите поле и сохраните.
      </Caption>
      {(formError || upsert.error) && (
        <Notice tone="danger" variant="text">
          {formError ?? vehicleServerErrorMessage(upsert.error)}
        </Notice>
      )}
      <Button
        stretched
        size="l"
        loading={upsert.isPending}
        onClick={save}
        className="min-h-11"
      >
        Сохранить автомобиль
      </Button>
      <Button
        stretched
        disabled={upsert.isPending}
        onClick={() => {
          setFormError(null);
          upsert.reset();
          onDone();
        }}
        className="min-h-11"
      >
        Отмена
      </Button>
    </>
  );
}
