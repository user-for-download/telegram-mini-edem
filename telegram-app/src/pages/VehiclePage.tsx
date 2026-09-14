import { useEffect, useRef, useState } from "react";
import { Button, Input, Section } from "@telegram-apps/telegram-ui";
import { Car, Palette, Hash } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ApiError } from "@/api/client";
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

/**
 * Автомобиль водителя (порт VK CarFormModal + блок «автомобиль» ProfilePanel).
 *
 * - Просмотр: модель + «цвет · номер» (номер — только свой, из /users/me;
 *   публичные выдачи plate не содержат — см. vehicleApi JSDoc).
 * - Empty-state (VK-копия): «Чтобы публиковать поездки, добавьте
 *   автомобиль» — без авто backend отклоняет создание поездки (NO_CAR).
 * - Добавление/редактирование: POST /users/me/car через useUpsertVehicleMutation
 *   (лимиты/нормализация — vehicleValidation, зеркало CarFormModal).
 * - Remove идентификатора: очистка поля номера + сохранение стирает plate
 *   (backend хранит null).
 * - Полное удаление: кнопка «Удалить автомобиль» → DELETE /users/me/car
 *   (ConfirmAction: первый клик вооружает, второй выполняет). При активных
 *   поездках backend блокирует 409 (инвариант: поездки требуют car) —
 *   показываем объяснение, а не общую ошибку. Полное удаление авто также
 *   происходит каскадом при удалении аккаунта (см. Профиль).
 * - Бан/удаление mid-session: requireUser отвечает 403 — терминальные
 *   экраны вместо общей ошибки (зеркально ProfilePage).
 */
export function VehiclePage() {
  const vehicleQuery = useVehicleQuery();
  const upsert = useUpsertVehicleMutation();
  const remove = useRemoveVehicleMutation();
  const vehicle = vehicleQuery.vehicle ?? null;

  const [editing, setEditing] = useState(false);
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос (паттерн CarFormModal).
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (vehicleQuery.data && !editing) {
      setModel(vehicleQuery.data.car?.model ?? "");
      setColor(vehicleQuery.data.car?.color ?? "");
      setPlate(vehicleQuery.data.car?.plate ?? "");
    }
  }, [vehicleQuery.data, editing]);

  if (vehicleQuery.error instanceof ApiError && vehicleQuery.error.status === 403) {
    if (vehicleQuery.error.message === "Account is deleted") {
      return (
        <>
          <PageHeader title="Автомобиль" />
          <p className="FormError" role="alert">
            Профиль удалён — данные автомобиля недоступны.
          </p>
        </>
      );
    }
    return (
      <>
        <PageHeader title="Автомобиль" />
        <p className="FormError" role="alert">
          Действие недоступно: аккаунт заблокирован.
        </p>
      </>
    );
  }

  const startEditing = () => {
    setFormError(null);
    upsert.reset();
    setEditing(true);
  };

  const cancelEditing = () => {
    setFormError(null);
    upsert.reset();
    setEditing(false);
  };

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
      onSuccess: () => setEditing(false),
      onSettled: () => {
        isSubmittingRef.current = false;
      },
    });
  };

  return (
    <>
      <PageHeader title="Автомобиль" action={{ label: "Профиль", to: "/profile" }} />
      <QueryState
        loading={vehicleQuery.isLoading}
        error={vehicleQuery.error}
        empty={!vehicleQuery.data}
        emptyText="Не удалось загрузить автомобиль."
        onRetry={() => void vehicleQuery.refetch()}
      >
        {vehicleQuery.data && (
          <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
          {/* Форма/карточка автомобиля: поверхность — Section без заголовка
              (заголовок страницы — PageHeader выше). */}
          <Section>
            <div className="flex flex-col gap-3 p-4">
              {editing ? (
                <>
                  <div className="FormField">
                    <label htmlFor="vehicle-model">Модель</label>
                    <Input
                      id="vehicle-model"
                      before={<Car size={17} className="text-(--app-info)" />}
                      value={model}
                      maxLength={VEHICLE_LIMITS.model}
                      placeholder="Skoda Octavia"
                      onChange={(event) => {
                        setModel(event.target.value.slice(0, VEHICLE_LIMITS.model));
                        if (formError) setFormError(null);
                      }}
                    />
                  </div>
                  <div className="FormField">
                    <label htmlFor="vehicle-color">Цвет</label>
                    <Input
                      id="vehicle-color"
                      before={<Palette size={16} className="text-(--tgui--hint_color)" />}
                      value={color}
                      maxLength={VEHICLE_LIMITS.color}
                      placeholder="белый"
                      onChange={(event) => {
                        setColor(event.target.value.slice(0, VEHICLE_LIMITS.color));
                        if (formError) setFormError(null);
                      }}
                    />
                  </div>
                  <div className="FormField">
                    <label htmlFor="vehicle-plate">Номер (необязательно)</label>
                    <Input
                      id="vehicle-plate"
                      before={<Hash size={16} className="text-(--tgui--hint_color)" />}
                      value={plate}
                      maxLength={VEHICLE_LIMITS.plate}
                      placeholder="Например: 583"
                      onChange={(event) => {
                        setPlate(
                          event.target.value.toUpperCase().slice(0, VEHICLE_LIMITS.plate),
                        );
                        if (formError) setFormError(null);
                      }}
                    />
                  </div>
                  <p className="text-[12px] text-(--tgui--hint_color) leading-relaxed">
                    Номер — примета для узнавания, видна только вам. Чтобы убрать номер,
                    очистите поле и сохраните.
                  </p>
                  {(formError || upsert.error) && (
                    <p className="FormError" role="alert">
                      {formError ?? vehicleServerErrorMessage(upsert.error)}
                    </p>
                  )}
                  <Button stretched size="l" loading={upsert.isPending} onClick={save}>
                    Сохранить автомобиль
                  </Button>
                  <Button
                    mode="bezeled"
                    stretched
                    disabled={upsert.isPending}
                    onClick={cancelEditing}
                  >
                    Отмена
                  </Button>
                </>
              ) : vehicle ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="icon-circle icon-circle--info">
                      <Car size={20} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[16px] font-semibold text-(--tgui--text_color) truncate">
                        {vehicle.model}
                      </div>
                      <div className="text-[13px] text-(--tgui--hint_color)">
                        {vehicle.plate ? `${vehicle.color} · ${vehicle.plate}` : vehicle.color}
                      </div>
                    </div>
                  </div>
                  <p className="text-[12px] text-(--tgui--hint_color) leading-relaxed">
                    Модель и цвет видят другие пользователи, номер — только вы.
                  </p>
                  <Button mode="bezeled" stretched size="s" onClick={startEditing}>
                    Изменить автомобиль
                  </Button>
                  <ConfirmAction
                    label="Удалить автомобиль"
                    confirmLabel="Да, удалить"
                    description="Автомобиль будет удалён из профиля. Без него нельзя создавать новые поездки. При активных поездках удаление заблокировано."
                    pending={remove.isPending}
                    onConfirm={() => remove.mutate(undefined)}
                  />
                  {remove.isError && (
                    <p className="FormError" role="alert">
                      {vehicleRemoveErrorMessage(remove.error)}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="icon-circle icon-circle--warning">
                      <Car size={20} />
                    </span>
                    <div>
                      <div className="text-[16px] font-semibold text-(--tgui--text_color)">
                        Автомобиль не добавлен
                      </div>
                      <div className="text-[13px] text-(--tgui--hint_color)">
                        Чтобы публиковать поездки, добавьте автомобиль.
                      </div>
                    </div>
                  </div>
                  <Button stretched size="l" onClick={startEditing}>
                    Добавить автомобиль
                  </Button>
                </>
              )}
            </div>
          </Section>
          </div>
        )}
      </QueryState>
    </>
  );
}
