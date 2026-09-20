import {
  Button,
  List,
  Placeholder,
  Section,
  Banner,
} from "@telegram-apps/telegram-ui";
import { Car, PlusCircle, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DriverRequestsSection } from "@/components/Section/DriverRequestsSection";
import { PopularRoutesSection } from "@/components/Section/PopularRoutesSection";
import { MyTripsSection } from "@/components/Section/MyTripsSection";
import { NextTripHero } from "@/components/Section/NextTripHero";
import { ProfileSection } from "@/components/Section/ProfileSection";
import { TripSearchSection } from "@/components/Section/TripSearchSection";
import { haptic } from "@/utils/haptics";
import { Fragment } from "react";

/**
 * Главная — только нативные компоненты @telegram-apps/telegram-ui
 * (List/Section/Cell/Badge/Banner/Placeholder), без кастомного CSS:
 * профиль-бар с рейтингом (Badge), экспресс-поиск на нативных Select
 * (системный дропдаун — без «напечатай и Enter»), брони двумя секциями
 * по статусу («Ваша поездка» / «Ожидают подтверждения»), сводка заявок
 * водителя (DriverRequestsSection), популярные направления (вертикальный
 * Cell-список), CTA водителю (Placeholder). Данные — реальные queries.
 */
export function HomePage() {
  const navigate = useNavigate();

  const goToSearch = (from?: string, to?: string) => {
    haptic.light();
    const params = new URLSearchParams();
    if (from?.trim()) params.set("from", from.trim());
    if (to?.trim()) params.set("to", to.trim());
    navigate(`/trips?${params.toString()}`);
  };

  return (
    <List>
      <ProfileSection />

      <NextTripHero />
      <TripSearchSection onSearch={goToSearch} />
      <MyTripsSection />
      <DriverRequestsSection />
      <PopularRoutesSection onSelect={goToSearch} />
      <Placeholder
        header="Едете на машине?"
        description="Найдите попутчиков в дорогу по области, чтобы разделить путь и совместные расходы"
        action={
          <Button
            size="l"
            mode="bezeled"
            before={<PlusCircle size={16} />}
            onClick={() => {
              haptic.light();
              navigate("/trips/my/new");
            }}
          >
            Создать поездку
          </Button>
        }
      />
    </List>
  );
}
