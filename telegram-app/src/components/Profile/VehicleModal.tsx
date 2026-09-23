import { useCallback, useRef, useState } from "react";
import {
  Button,
  Caption,
  Input,
  Modal,
} from "@telegram-apps/telegram-ui";
import { Car, Hash, Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { haptic } from "@/utils/haptics";
import { QueryState } from "@/components/QueryState";
import { SheetBody } from "@/ui/SheetBody";
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
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
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
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Автомобиль</Modal.Header>}
      aria-labelledby={titleId}
    >
      <SheetBody>
        <SheetTitle titleId={titleId}>Автомобиль</SheetTitle>
        <VehicleBody onDone={onClose} />
      </SheetBody>
    </Modal>
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
    <Caption
      Component="p"
      className={styles.errorScreen}
      role="alert"
    >
      {deleted
        ? "Профиль удалён — данные автомобиля недоступны."
        : "Действие недоступно: аккаунт заблокирован."}
    </Caption>
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
        <div className={styles.card}>
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
                <Caption
                  Component="p"
                  role="alert"
                  className={styles.errorText}
                >
                  {vehicleRemoveErrorMessage(remove.error)}
                </Caption>
              )}
            </>
          )}
        </div>
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
      <div>
        <label htmlFor="vehicle-model" className="sr-only">
          Модель
        </label>
        <Input
          id="vehicle-model"
          header="Модель"
          before={<Car size={17} className={styles.info} />}
          value={model}
          maxLength={VEHICLE_LIMITS.model}
          placeholder="Skoda Octavia"
          onChange={(e) => {
            setModel(e.target.value.slice(0, VEHICLE_LIMITS.model));
            if (formError) setFormError(null);
          }}
        />
      </div>
      <div>
        <label htmlFor="vehicle-color" className="sr-only">
          Цвет
        </label>
        <Input
          id="vehicle-color"
          header="Цвет"
          before={<Palette size={16} className={styles.hint} />}
          value={color}
          maxLength={VEHICLE_LIMITS.color}
          placeholder="белый"
          onChange={(e) => {
            setColor(e.target.value.slice(0, VEHICLE_LIMITS.color));
            if (formError) setFormError(null);
          }}
        />
      </div>
      <div>
        <label htmlFor="vehicle-plate" className="sr-only">
          Номер (необязательно)
        </label>
        <Input
          id="vehicle-plate"
          header="Номер (необязательно)"
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
      </div>
      <Caption Component="p" className={styles.prose}>
        Номер — примета для узнавания, видна только вам. Чтобы убрать номер,
        очистите поле и сохраните.
      </Caption>
      {(formError || upsert.error) && (
        <Caption
          Component="p"
          role="alert"
          className={styles.errorText}
        >
          {formError ?? vehicleServerErrorMessage(upsert.error)}
        </Caption>
      )}
      <Button
        mode="bezeled"
        stretched
        size="l"
        loading={upsert.isPending}
        onClick={save}
        className="min-h-11"
      >
        Сохранить автомобиль
      </Button>
      <Button
        mode="bezeled"
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
