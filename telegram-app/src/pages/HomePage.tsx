import { useMemo, useState, type SubmitEvent } from "react";
import {
  Avatar,
  Badge,
  Button,
  Cell,
  IconContainer,
  IconButton,
  List,
  Placeholder,
  Section,
  Skeleton,
  Headline,
  Blockquote,
  Subheadline,
  Caption,
} from "@telegram-apps/telegram-ui";
import { ChevronRight, PlusCircle, Route, Search, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CitySelectField } from "@/components/CitySelectField";
import { DriverRequestsSection } from "@/components/DriverRequestsSection";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";
import { haptic } from "@/utils/haptics";
import {
  confirmedSectionHeader,
  formatSeatNumber,
  splitBookingsByStatus,
} from "@/utils/bookingSplit";
import { useProfileQuery } from "@/queries/profile";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";
import type { PassengerBooking } from "@edem/contracts";

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
              <BookingCell key={booking.id} booking={booking} />
            ))}
          </Section>
        )}
        {pending.length > 0 && (
          <Section header="Ожидают подтверждения">
            {pending.map((booking) => (
              <BookingCell key={booking.id} booking={booking} />
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
 * Бронь пассажира — нативная ячейка: аватар водителя, маршрут с dot-бейджем,
 * «когда и время», описание — комментарий водителя о поездке с атрибуцией
 * «От водителя: …» (свой комментарий пассажира здесь не показываем —
 * он виден водителю в досье заявки). Статус не дублируется — он задан
 * заголовком секции.
 */
function BookingCell({ booking }: { booking: PassengerBooking }) {
  const navigate = useNavigate();
  const openTrip = () => {
    haptic.light();
    navigate(`/trips/${booking.trip.id}`);
  };
  // Комментарий пассажира (booking.comment) на главной не показываем:
  // это текст для водителя. Пассажиру актуален комментарий водителя
  // к поездке — с явной атрибуцией, чей это текст.
  const driverComment = booking.trip.comment;
  return (
    <Cell
      type="button"
      multiline
      onClick={openTrip}
      before={
        <Avatar
          size={48}
          acronym={(booking.trip.driver.name ?? "?").slice(0, 2).toUpperCase()}
          src={booking.trip.driver.avatar}
        >
          <Avatar.Badge mode="white" type="number">
            {booking.trip.driver.rating}
          </Avatar.Badge>
        </Avatar>
      }
      subtitle={
        <Subheadline weight="1">
          {booking.trip.fromCity} → {booking.trip.toCity}
        </Subheadline>
      }
      description={
        booking.status === "confirmed" && driverComment ? (
          <Caption level="2">
            <Blockquote type="other">{`${driverComment}`}</Blockquote>
          </Caption>
        ) : undefined
      }
      after={
        <IconButton
          mode="bezeled"
          size="s"
          aria-label="Открыть поездку"
          onClick={openTrip}
        >
          <ChevronRight size={20} />
        </IconButton>
      }
    >
      {`${booking.trip.date}`}
      <Badge mode="secondary" type="number">
        {booking.trip.price}₽
      </Badge>
    </Cell>
  );
}
