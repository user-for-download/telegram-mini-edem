import {
  useCallback,
  useRef,
  useState,
} from "react";
import { Button, Input, Modal } from "@telegram-apps/telegram-ui";
import { Car, Hash, Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { ConfirmAction } from "@/components/ConfirmAction";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { haptic } from "@/utils/haptics";
import { QueryState } from "@/components/QueryState";
import { ProfilePage } from "@/pages/ProfilePage";
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
} from "@/pages/vehicleValidation";

type Vehicle = NonNullable<ReturnType<typeof useVehicleQuery>["vehicle"]>;

/**
 * Автомобиль водителя — модальная шторка (в Telegram нет «новых страниц»,
 * только модалки; роут /vehicle остаётся источником правды, вход из
 * ProfilePage тем же navigate("/vehicle") — см. VehicleRoute).
 */
export function VehicleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} header={<Modal.Header>Автомобиль</Modal.Header>}>
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto">
        <VehicleBody onDone={onClose} />
      </div>
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

/** Терминальный экран бана/удаления mid-session (зеркально VehiclePage). */
function VehicleTerminal({ deleted }: { deleted: boolean }) {
  return (
    <p className="FormError px-4 pt-4" role="alert">
      {deleted ? "Профиль удалён — данные автомобиля недоступны." : "Действие недоступно: аккаунт заблокирован."}
    </p>
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
  if (vehicleQuery.error instanceof ApiError && vehicleQuery.error.status === 403) {
    return <VehicleTerminal deleted={vehicleQuery.error.message === "Account is deleted"} />;
  }
  return (
    <QueryState loading={vehicleQuery.isLoading} error={vehicleQuery.error} empty={!vehicleQuery.data} emptyText="Не удалось загрузить автомобиль." onRetry={() => void vehicleQuery.refetch()}>
      {vehicleQuery.data && (
        <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3">
          {!vehicle && (
            <p className="text-[13px] text-[var(--tgui--hint_color)] leading-relaxed">
              Чтобы публиковать поездки, добавьте автомобиль.
            </p>
          )}
          <VehicleForm vehicle={vehicle} onDone={onDone} />
          {vehicle && (
            <>
              <ConfirmAction label="Удалить автомобиль" confirmLabel="Да, удалить" description="Автомобиль будет удалён из профиля. Без него нельзя создавать новые поездки. При активных поездках удаление заблокировано." pending={remove.isPending} onConfirm={() => remove.mutate(undefined, { onSuccess: () => haptic.success(), onError: () => haptic.error() })} />
              {remove.isError && <p className="FormError" role="alert">{vehicleRemoveErrorMessage(remove.error)}</p>}
            </>
          )}
        </div>
      )}
    </QueryState>
  );
}

/** Добавление/редактирование через POST /users/me/car (лимиты — vehicleValidation). */
function VehicleForm({ vehicle, onDone }: { vehicle: Vehicle | null; onDone: () => void }) {
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
    if (error) { setFormError(error); return; }
    setFormError(null);
    isSubmittingRef.current = true;
    upsert.mutate(normalizeVehicleForm(model, color, plate), {
      onSuccess: () => {
        haptic.success();
        onDone();
      },
      onError: () => haptic.error(),
      onSettled: () => { isSubmittingRef.current = false; },
    });
  };
  return (
    <>
      <div className="FormField">
        <label htmlFor="vehicle-model">Модель</label>
        <Input id="vehicle-model" before={<Car size={17} className="text-[var(--app-info)]" />} value={model} maxLength={VEHICLE_LIMITS.model} placeholder="Skoda Octavia" onChange={(e) => { setModel(e.target.value.slice(0, VEHICLE_LIMITS.model)); if (formError) setFormError(null); }} />
      </div>
      <div className="FormField">
        <label htmlFor="vehicle-color">Цвет</label>
        <Input id="vehicle-color" before={<Palette size={16} className="text-[var(--tgui--hint_color)]" />} value={color} maxLength={VEHICLE_LIMITS.color} placeholder="белый" onChange={(e) => { setColor(e.target.value.slice(0, VEHICLE_LIMITS.color)); if (formError) setFormError(null); }} />
      </div>
      <div className="FormField">
        <label htmlFor="vehicle-plate">Номер (необязательно)</label>
        <Input id="vehicle-plate" before={<Hash size={16} className="text-[var(--tgui--hint_color)]" />} value={plate} maxLength={VEHICLE_LIMITS.plate} placeholder="Например: 583" onChange={(e) => { setPlate(e.target.value.toUpperCase().slice(0, VEHICLE_LIMITS.plate)); if (formError) setFormError(null); }} />
      </div>
      <p className="text-[12px] text-[var(--tgui--hint_color)] leading-relaxed">Номер — примета для узнавания, видна только вам. Чтобы убрать номер, очистите поле и сохраните.</p>
      {(formError || upsert.error) && <p className="FormError" role="alert">{formError ?? vehicleServerErrorMessage(upsert.error)}</p>}
      <Button stretched size="l" loading={upsert.isPending} onClick={save} className="min-h-[44px]">Сохранить автомобиль</Button>
      <Button mode="bezeled" stretched disabled={upsert.isPending} onClick={() => { setFormError(null); upsert.reset(); onDone(); }} className="min-h-[44px]">Отмена</Button>
    </>
  );
}
