import { useEffect, useState } from "react";
import { VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { PlusCircle, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { NextTripBanner } from "@/components/Section/NextTripBanner";
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

  // id городов, не имена: поиск фильтрует по справочнику, а имя
  // неоднозначно («Москва» входит в «Москва-…»).
  const goToSearch = (fromCityId?: string, toCityId?: string) => {
    haptic.light();
    const params = new URLSearchParams();
    if (fromCityId) params.set("fromCityId", fromCityId);
    if (toCityId) params.set("toCityId", toCityId);
    const query = params.toString();
    navigate(query ? `/trips?${query}` : "/trips");
  };

  const goToCreate = () => {
    haptic.light();
    // Авто уже известно: есть — сразу на форму; нет — шторка здесь же.
    // Пока авто грузится — идём на форму: гейт там сам откроет шторку.
    if (vehicleReady && !hasCar) {
      setPendingCreate(true);
      setVehicleOpen(true);
      return;
    }
    navigate("/trips/my/new");
  };

  // Заявка на попутку — route-backed шторка поверх «Поиска»: роут
  // /ride-requests (AppRouter), а не локальный state, чтобы точка входа
  // была ссылкой, а Back закрывал шторку.
  const goToRideRequests = () => {
    haptic.light();
    navigate("/ride-requests");
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
      {/* Имя экрана — здесь, а не в заголовке секции (реестр #15):
          NavHeader помечен aria-hidden. */}
      <VisuallyHidden Component="h1">Главная</VisuallyHidden>
      <ProfileSection />
      <TripCountersSection />
      <NextTripBanner />
      <TripSearchSection onSearch={goToSearch} />
      <PopularRoutesSection onSelect={goToSearch} />
      <EmptyState
        header="Едете на машине?"
        description="Найдите попутчиков в дорогу по области, чтобы разделить путь и совместные расходы"
        action={
          <Button
            size="l"
            before={<PlusCircle size={16} />}
            onClick={goToCreate}
          >
            Создать поездку
          </Button>
        }
      />
      {/* Пассажирский CTA — отдельным блоком, а не второй кнопкой в
          водительском: «Едете на машине?» — про водителя, и пассажиру он
          враньё. Свой заголовок и своё действие у каждой роли. */}
      <EmptyState
        header="Нужна попутка?"
        description="Оставьте заявку с маршрутом и датой — водители с подходящей поездкой её увидят"
        action={
          <Button
            size="l"
            before={<Users size={16} />}
            onClick={goToRideRequests}
          >
            Ищу попутку
          </Button>
        }
      />
      <VehicleModal open={vehicleOpen} onClose={closeVehicle} />
    </Page>
  );
}
