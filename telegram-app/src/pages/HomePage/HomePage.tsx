import { useEffect, useState } from "react";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";

import { PlusCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PopularRoutesSection } from "@/components/Section/PopularRoutesSection";
import { ProfileSection } from "@/components/Section/ProfileSection";
import { TripCountersSection } from "@/components/Section/TripCountersSection";
import { TripSearchSection } from "@/components/Section/TripSearchSection";
import { VehicleModal } from "@/components/Profile/VehicleModal";
import { useVehicleQuery } from "@/queries/vehicle";
import { useModalBack } from "@/utils/modalBack";
import { haptic } from "@/utils/haptics";
import { Page } from "@/ui/Page";

export function HomePage() {
  const navigate = useNavigate();
  // Нет авто — шторка VehicleModal прямо здесь, без ухода на /trips/my/new:
  // иначе за шторкой оставался бы полноэкранный гейт «Нужен автомобиль».
  const vehicleQuery = useVehicleQuery();
  const hasCar = (vehicleQuery.vehicle ?? null) !== null;
  const vehicleReady = !vehicleQuery.isLoading && !vehicleQuery.isFetching;
  const [vehicleOpen, setVehicleOpen] = useState(false);
  // Шторка открыта из CTA «Создать поездку»: после успешного сохранения
  // уходим на форму создания (а не остаёмся на Главной).
  const [pendingCreate, setPendingCreate] = useState(false);
  useModalBack(() => setVehicleOpen(false), vehicleOpen);

  const goToSearch = (from?: string, to?: string) => {
    haptic.light();
    const params = new URLSearchParams();
    if (from?.trim()) params.set("from", from.trim());
    if (to?.trim()) params.set("to", to.trim());
    navigate(`/trips?${params.toString()}`);
  };

  const goToCreate = () => {
    haptic.light();
    // Авто уже известно: есть — сразу на форму; нет — шторка здесь же.
    // Пока профиль грузится — идём на форму: гейт там сам откроет шторку.
    if (vehicleReady && !hasCar) {
      setPendingCreate(true);
      setVehicleOpen(true);
      return;
    }
    navigate("/trips/my/new");
  };

  useEffect(() => {
    // Авто появилось после сохранения в шторке (кэш ["users","me"]
    // обновляется в onSuccess мутации раньше onDone → onClose): шторка уже
    // закрыта самим VehicleBody, уходим на форму создания.
    // setState по готовности данных — штатный sync React с внешним кэшем
    // (см. LazyAvatar: смена src сбрасывает ошибку в render-фазе вместо
    // эффекта react-hooks/set-state-in-effect).
    if (pendingCreate && vehicleReady && hasCar) {
      queueMicrotask(() => {
        setPendingCreate(false);
        setVehicleOpen(false);
        navigate("/trips/my/new");
      });
    }
  }, [pendingCreate, vehicleOpen, vehicleReady, hasCar, navigate]);

  const closeVehicle = () => {
    // Ручное закрытие без сохранения: флаг намерения сбрасываем только
    // когда авто так и не появилось — иначе выше уже ушли на форму.
    if (!((vehicleQuery.vehicle ?? null) !== null)) setPendingCreate(false);
    setVehicleOpen(false);
  };

  return (
    <Page>
      <ProfileSection />
      <TripCountersSection />
      <TripSearchSection onSearch={goToSearch} />
      <PopularRoutesSection onSelect={goToSearch} />
      {/* Промо-CTA (маркетинг, не «нет данных»): тексты-литералы здесь
          сознательны — их НЕТ в словаре EMPTY_STATES (см. там же «Граница»),
          а сам компонент — тот же экран-заглушка ui/EmptyState. */}
      <EmptyState
        header="Едете на машине?"
        description="Найдите попутчиков в дорогу по области, чтобы разделить путь и совместные расходы"
        action={
          <Button size="l" before={<PlusCircle size={16} />} onClick={goToCreate}>
            Создать поездку
          </Button>
        }
      />
      <VehicleModal open={vehicleOpen} onClose={closeVehicle} />
    </Page>
  );
}
