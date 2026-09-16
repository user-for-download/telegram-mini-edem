import { useEffect, useRef, useState } from "react";
import {
  Button,
  Caption,
  IconContainer,
  Input,
  Section,
  Text,
} from "@telegram-apps/telegram-ui";
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

  if (
    vehicleQuery.error instanceof ApiError &&
    vehicleQuery.error.status === 403
  ) {
    if (vehicleQuery.error.message === "Account is deleted") {
      return (
        <>
          <PageHeader title="Автомобиль" />
          <Caption
            Component="p"
            role="alert"
            className="text-(--tg-theme-destructive-text-color)"
          >
            Профиль удалён — данные автомобиля недоступны.
          </Caption>
        </>
      );
    }
    return (
      <>
        <PageHeader title="Автомобиль" />
        <Caption
          Component="p"
          role="alert"
          className="text-(--tg-theme-destructive-text-color)"
        >
          Действие недоступно: аккаунт заблокирован.
        </Caption>
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
      <PageHeader
        title="Автомобиль"
        action={{ label: "Профиль", to: "/profile" }}
      />
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
                    <div>
                      <label htmlFor="vehicle-model" className="sr-only">
                        Модель
                      </label>
                      <Input
                        id="vehicle-model"
                        header="Модель"
                        before={<Car size={17} className="text-(--app-info)" />}
                        value={model}
                        maxLength={VEHICLE_LIMITS.model}
                        placeholder="Skoda Octavia"
                        onChange={(event) => {
                          setModel(
                            event.target.value.slice(0, VEHICLE_LIMITS.model),
                          );
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
                        before={
                          <Palette
                            size={16}
                            className="text-(--tgui--hint_color)"
                          />
                        }
                        value={color}
                        maxLength={VEHICLE_LIMITS.color}
                        placeholder="белый"
                        onChange={(event) => {
                          setColor(
                            event.target.value.slice(0, VEHICLE_LIMITS.color),
                          );
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
                        before={
                          <Hash
                            size={16}
                            className="text-(--tgui--hint_color)"
                          />
                        }
                        value={plate}
                        maxLength={VEHICLE_LIMITS.plate}
                        placeholder="Например: 583"
                        onChange={(event) => {
                          setPlate(
                            event.target.value
                              .toUpperCase()
                              .slice(0, VEHICLE_LIMITS.plate),
                          );
                          if (formError) setFormError(null);
                        }}
                      />
                    </div>
                    <Caption Component="p" className="leading-relaxed">
                      Номер — примета для узнавания, видна только вам. Чтобы
                      убрать номер, очистите поле и сохраните.
                    </Caption>
                    {(formError || upsert.error) && (
                      <Caption
                        Component="p"
                        role="alert"
                        className="text-(--tg-theme-destructive-text-color)"
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
                    >
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
                      <IconContainer>
                        <Car size={20} />
                      </IconContainer>
                      <div className="min-w-0">
                        <Text weight="2" Component="div" className="truncate">
                          {vehicle.model}
                        </Text>
                        <Caption
                          Component="div"
                          className="text-(--tgui--hint_color)"
                        >
                          {vehicle.plate
                            ? `${vehicle.color} · ${vehicle.plate}`
                            : vehicle.color}
                        </Caption>
                      </div>
                    </div>
                    <Caption Component="p" className="leading-relaxed">
                      Модель и цвет видят другие пользователи, номер — только
                      вы.
                    </Caption>
                    <Button
                      mode="bezeled"
                      stretched
                      size="s"
                      onClick={startEditing}
                    >
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
                      <Caption
                        Component="p"
                        role="alert"
                        className="text-(--tg-theme-destructive-text-color)"
                      >
                        {vehicleRemoveErrorMessage(remove.error)}
                      </Caption>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <IconContainer>
                        <Car size={20} />
                      </IconContainer>
                      <div>
                        <Text weight="2" Component="div">
                          Автомобиль не добавлен
                        </Text>
                        <Caption
                          Component="div"
                          className="text-(--tgui--hint_color)"
                        >
                          Чтобы публиковать поездки, добавьте автомобиль.
                        </Caption>
                      </div>
                    </div>
                    <Button
                      mode="bezeled"
                      stretched
                      size="l"
                      onClick={startEditing}
                    >
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
