import {
  Button,
  List,
  Placeholder,
  Section,
  Banner,
} from "@telegram-apps/telegram-ui";
import { Car, PlusCircle, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PopularRoutesSection } from "@/components/Section/PopularRoutesSection";
import { ProfileSection } from "@/components/Section/ProfileSection";
import { TripCountersSection } from "@/components/Section/TripCountersSection";
import { TripSearchSection } from "@/components/Section/TripSearchSection";
import { haptic } from "@/utils/haptics";
import { Fragment } from "react";

/**
 * Главная — только нативные компоненты @telegram-apps/telegram-ui
 * (List/Section/Cell/Badge/Banner/Placeholder), без кастомного CSS:
 * профиль-бар с рейтингом (Badge), экспресс-поиск на нативных Select
 * (системный дропдаун — без «напечатай и Enter»), сводка-счётчики
 * (TripCountersSection: поездки/брони/заявки — строки только при count > 0,
 * карточки живут на /bookings), популярные направления (вертикальный
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

      <TripCountersSection />
      <TripSearchSection onSearch={goToSearch} />
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
