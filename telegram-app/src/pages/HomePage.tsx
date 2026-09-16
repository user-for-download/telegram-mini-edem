import { useState, type SubmitEvent } from "react";
import {
  Avatar,
  Button,
  Cell,
  Section,
  Badge,
  IconContainer,
  Info,
  List,
  Blockquote,
  Skeleton,
  Text,
} from "@telegram-apps/telegram-ui";
import {
  PlusCircle,
  Route,
  Search,
  ShieldCheck,
  Star,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusPill } from "@/components/StatusPill";
import { CityPickerField } from "@/components/CityPickerField";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";
import { haptic } from "@/utils/haptics";
import { useProfileQuery } from "@/queries/profile";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";

/**
 * Главная (лендинг, язык HomeTab примера): профиль-бар с рейтингом,
 * экспресс-поиск (города + день) с переходом на /trips с пресетом,
 * ближайшая активная бронь, CTA водителю, популярные направления,
 * преимущества. Данные — реальные queries (profile/bookings).
 */
export function HomePage() {
  const navigate = useNavigate();
  const profile = useProfileQuery();
  const bookings = useMyBookingsQuery();
  const cities = useAllCitiesQuery();

  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");

  const activeBooking = (bookings.data ?? [])
    .filter(
      (booking) =>
        booking.status === "confirmed" || booking.status === "pending",
    )
    .sort((a, b) => {
      const aTime = a.trip.departureAt ? Date.parse(a.trip.departureAt) : 0;
      const bTime = b.trip.departureAt ? Date.parse(b.trip.departureAt) : 0;
      return aTime - bTime;
    })[0];

  const goToSearch = (from?: string, to?: string) => {
    haptic.light();
    const params = new URLSearchParams();
    const fromValue = from ?? fromCity;
    const toValue = to ?? toCity;
    if (fromValue.trim()) params.set("from", fromValue.trim());
    if (toValue.trim()) params.set("to", toValue.trim());
    navigate(`/trips?${params.toString()}`);
  };

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault();
    goToSearch();
  };

  return (
    <List>
      <Skeleton visible={profile.isLoading ? true : false} withoutAnimation>
        <Cell
          type="button"
          onClick={() => {
            haptic.light();
            navigate("/profile");
          }}
          after={
            <>
              <Star size={16} />
              <span>{profile.data ? profile.data.rating.toFixed(1) : "—"}</span>
            </>
          }
          before={
            <Avatar
              size={40}
              src={profile.data?.avatar}
              acronym={(profile.data?.name ?? "ЕД").slice(0, 2).toUpperCase()}
            />
          }
          aria-label="Открыть профиль"
          subtitle={`Поездок: ${profile.data?.tripsCount ?? 0}`}
          titleBadge={<Badge type="dot" />}
        >
          {profile.data?.name ?? "Попутчик"}
        </Cell>
      </Skeleton>
      <form onSubmit={submitSearch}>
        <Section
          header="Куда поедем?"
          footer={
            <Button
              size="l"
              stretched
              mode="bezeled"
              before={<Search size={18} />}
              type="submit"
            >
              Найти поездку
            </Button>
          }
        >
          <CityPickerField
            id="home-from"
            label="Откуда"
            value={fromCity}
            cities={cities.data}
            placeholder="Город или село отправления"
            onSelect={setFromCity}
          />
          <CityPickerField
            id="home-to"
            label="Куда"
            value={toCity}
            cities={cities.data}
            placeholder="Город или село назначения"
            onSelect={setToCity}
          />
        </Section>
      </form>
      <Skeleton visible={bookings.isLoading ? true : false} withoutAnimation>
        {!bookings.error && activeBooking && (
          <Section
            header="Ближайшая поездка"
            footer={
              activeBooking.status === "confirmed" ? (
                <Blockquote type="other">
                  {activeBooking.trip.comment}
                </Blockquote>
              ) : undefined
            }
          >
            <Cell
              type="button"
              onClick={() => {
                haptic.light();
                navigate(`/trips/${activeBooking.trip.id}`);
              }}
              after={
                <Info subtitle={`${activeBooking.seat} место`} type="text">
                  <Text weight="2">
                    {activeBooking.trip.price * activeBooking.seat} ₽
                  </Text>
                </Info>
              }
              before={
                <Avatar
                  src={activeBooking.trip.driver.avatar}
                  size={48}
                  acronym={(activeBooking.trip.driver.name ?? "?")
                    .slice(0, 2)
                    .toUpperCase()}
                />
              }

              subhead={`${activeBooking.trip.date} · ${activeBooking.trip.time}`}
              subtitle={`Водитель: ${activeBooking.trip.driver.name ?? "—"}`}
              description={
                <StatusPill
                  tone={
                    activeBooking.status === "confirmed" ? "success" : "warning"
                  }
                >
                  {activeBooking.status === "confirmed"
                    ? "Подтверждено"
                    : "Ожидает подтверждения"}
                </StatusPill>
              }
            >
              {activeBooking.trip.fromCity} → {activeBooking.trip.toCity}
            </Cell>
          </Section>
        )}
      </Skeleton>
      <Section header="Популярные направления">
        {POPULAR_ROUTES.map((route) => (
          <Cell
            key={`${route.from}-${route.to}`}
            type="button"
            onClick={() => goToSearch(route.from, route.to)}
            before={
              <IconContainer>
                <Route size={22} />
              </IconContainer>
            }
          >
            {route.from} → {route.to}
          </Cell>
        ))}
      </Section>
      <Section
        header="Едете на машине?"
        footer={
          <Button
            size="l"
            stretched
            mode="bezeled"
            type="button"
            onClick={() => {
              haptic.light();
              navigate("/trips/my/new");
            }}
            before={<PlusCircle size={16} />}
          >
            Создать поездку
          </Button>
        }
      >
        <Section.Header large>
          Найдите попутчиков в дорогу по области, чтобы разделить путь и
          совместные расходы
        </Section.Header>
      </Section>

      <Section header="Преимущества Едем">
        <Cell
          before={
            <IconContainer>
              <ShieldCheck size={22} />
            </IconContainer>
          }
          subtitle="Верификация через Telegram ID"
        >
          Безопасность и проверка
        </Cell>
        <Cell
          before={
            <IconContainer>
              <Star size={22} />
            </IconContainer>
          }
          subtitle="Честные отзывы только после завершённых поездок"
        >
          Честный рейтинг
        </Cell>
        <Cell
          before={
            <IconContainer>
              <TrendingUp size={22} />
            </IconContainer>
          }
          subtitle="Дешевле, чем автобус или такси между районами области"
        >
          Выгодные цены
        </Cell>
      </Section>
    </List>
  );
}
