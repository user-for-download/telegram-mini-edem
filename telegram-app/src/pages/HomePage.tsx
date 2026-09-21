import { Button, List, Placeholder } from "@telegram-apps/telegram-ui";
import { PlusCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PopularRoutesSection } from "@/components/Section/PopularRoutesSection";
import { ProfileSection } from "@/components/Section/ProfileSection";
import { TripCountersSection } from "@/components/Section/TripCountersSection";
import { TripSearchSection } from "@/components/Section/TripSearchSection";
import { haptic } from "@/utils/haptics";

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
