import { useMemo, useState, type SubmitEvent } from "react";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Cell,
  IconContainer,
  List,
  Placeholder,
  Section,
  Skeleton,
  Headline,
} from "@telegram-apps/telegram-ui";
import { PlusCircle, Route, Search, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CitySelectField } from "@/components/CitySelectField";
import { DriverRequestsSection } from "@/components/DriverRequestsSection";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";
import { haptic } from "@/utils/haptics";
import {
  confirmedSectionHeader,
  splitBookingsByStatus,
} from "@/utils/bookingSplit";
import { useProfileQuery } from "@/queries/profile";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";
import type { PassengerBooking } from "@edem/contracts";
import { formatSeats } from "@/utils/bookingSplit";

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
  const profile = useProfileQuery();
  const bookings = useMyBookingsQuery();
  const cities = useAllCitiesQuery();

  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");

  // Брони двумя группами по статусу (будущие confirmed и pending).
  const { confirmed, pending } = useMemo(
    () => splitBookingsByStatus(bookings.data ?? []),
    [bookings.data],
  );

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
      <Skeleton visible={profile.isLoading} withoutAnimation>
        <Cell
          type="button"
          onClick={() => {
            haptic.light();
            navigate("/profile");
          }}
          after={
            <>
              <Badge type="number" large mode="secondary">
                <Headline weight="2">
                  {profile.data ? profile.data.rating.toFixed(1) : "—"}
                </Headline>
              </Badge>
            </>
          }
          before={
            <Avatar
              size={40}
              src={profile.data?.avatar}
              acronym={(profile.data?.name ?? "ЕД").slice(0, 2).toUpperCase()}
            />
          }
          subtitle={`Поездок: ${profile.data?.tripsCount ?? 0}`}
          aria-label="Открыть профиль"
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
          <CitySelectField
            id="home-from"
            label="Откуда"
            value={fromCity}
            cities={cities.data}
            placeholder="Город или село отправления"
            onSelect={setFromCity}
          />
          <CitySelectField
            id="home-to"
            label="Куда"
            value={toCity}
            cities={cities.data}
            placeholder="Город или село назначения"
            onSelect={setToCity}
          />
        </Section>
      </form>
      <Skeleton visible={bookings.isLoading} withoutAnimation>
        {confirmed.length > 0 && (
          <Section header={confirmedSectionHeader(confirmed.length)}>
            {confirmed.map((booking) => (
              <BookingBanner key={booking.id} booking={booking} />
            ))}
          </Section>
        )}
        {pending.length > 0 && (
          <Section header="Ожидают подтверждения">
            {pending.map((booking) => (
              <BookingBanner key={booking.id} booking={booking} />
            ))}
          </Section>
        )}
      </Skeleton>
      <DriverRequestsSection />
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

/**
 * Баннер брони пассажира: маршрут, время, водитель, места/цена.
 * Статус не дублируется в описании — он задан заголовком секции.
 */
function BookingBanner({ booking }: { booking: PassengerBooking }) {
  const navigate = useNavigate();
  return (
    <Banner
      type="section"
      onClick={() => {
        haptic.light();
        navigate(`/trips/${booking.trip.id}`);
      }}
      before={
        <Avatar
          size={48}
          src={booking.trip.driver.avatar}
          acronym={(booking.trip.driver.name ?? "?").slice(0, 2).toUpperCase()}
        />
      }
      header={`${booking.trip.fromCity} → ${booking.trip.toCity}`}
      subheader={`${booking.trip.date} · ${booking.trip.time} · Водитель: ${booking.trip.driver.name ?? "—"}`}
      description={`${formatSeats(booking.seat)} · ${booking.trip.price * booking.seat} ₽`}
      callout={
        booking.status === "confirmed" ? booking.trip.comment : undefined
      }
    />
  );
}
