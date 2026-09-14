import { useState, type FormEvent } from "react";
import {
  Avatar,
  Banner,
  Button,
  Cell,
  Input,
  Section,
  SegmentedControl,
  IconButton,
  Tappable,
} from "@telegram-apps/telegram-ui";
import {
  ChevronRight,
  MapPin,
  PlusCircle,
  Search,
  ShieldCheck,
  Star,
  TrendingUp,
  ArrowRightLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SectionTitle } from "@/components/SectionTitle";
import { ProfileBarSkeleton } from "@/components/Skeletons";
import { TripCardSkeleton } from "@/components/Skeletons";
import { POPULAR_ROUTES } from "@/consts/popularRoutes";
import { haptic } from "@/utils/haptics";
import { dayTimeLabel } from "@/utils/date";
import type { DateSegment } from "@/helpers/searchFilters";
import { useProfileQuery } from "@/queries/profile";
import { useMyBookingsQuery } from "@/queries/useBookingsQuery";

const DAY_SEGMENTS: ReadonlyArray<{ value: Exclude<DateSegment, "all">; label: string }> = [
  { value: "today", label: "Сегодня" },
  { value: "tomorrow", label: "Завтра" },
  { value: "weekend", label: "Выходные" },
];

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

  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");
  const [day, setDay] = useState<Exclude<DateSegment, "all">>("today");

  const activeBooking = (bookings.data ?? [])
    .filter((booking) => booking.status === "confirmed" || booking.status === "pending")
    .sort((a, b) => {
      const aTime = a.trip.departureAt ? Date.parse(a.trip.departureAt) : 0;
      const bTime = b.trip.departureAt ? Date.parse(b.trip.departureAt) : 0;
      return aTime - bTime;
    })[0];

  const swapCities = () => {
    haptic.selection();
    setFromCity(toCity);
    setToCity(fromCity);
  };

  const goToSearch = (from?: string, to?: string, segment?: DateSegment) => {
    haptic.light();
    const params = new URLSearchParams();
    const fromValue = from ?? fromCity;
    const toValue = to ?? toCity;
    if (fromValue.trim()) params.set("from", fromValue.trim());
    if (toValue.trim()) params.set("to", toValue.trim());
    params.set("segment", segment ?? day);
    navigate(`/trips?${params.toString()}`);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    goToSearch();
  };

  return (
    <>
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
        {/* Профиль-бар: Cell (аватар + имя + пилюля рейтинга).
            Ошибка профиля лендинг не блокирует — тихий фолбэк. */}
        {profile.isLoading ? (
          <ProfileBarSkeleton />
        ) : (
          <Cell
            before={
              <Avatar
                size={40}
                src={profile.data?.avatar}
                acronym={(profile.data?.name ?? "ЕД").slice(0, 2).toUpperCase()}
              />
            }
            after={
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-(--tgui--secondary_fill) text-(--tgui--text_color) text-xs font-semibold shrink-0">
                <Star size={13} className="fill-(--app-rating) text-(--app-rating)" />
                <span>{profile.data ? profile.data.rating.toFixed(1) : "—"}</span>
              </span>
            }
          >
            {profile.data?.name ?? "Попутчик"}
          </Cell>
        )}

        {/* Экспресс-поиск: карточка формы (паттерн TripCard) */}
        <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-sm">
          <div className="mb-2">
            <SectionTitle title="Куда поедем?" hint="Поиск попуток" />
          </div>

            <form onSubmit={submitSearch} className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1.5 relative">
                <Input
                  header="Откуда"
                  before={<MapPin size={17} className="text-(--app-info)" />}
                  value={fromCity}
                  onChange={(event) => setFromCity(event.target.value)}
                  placeholder="Город или село отправления"
                />
                <Input
                  header="Куда"
                  before={<MapPin size={17} className="text-(--app-success)" />}
                  value={toCity}
                  onChange={(event) => setToCity(event.target.value)}
                  placeholder="Город или село назначения"
                />
                <IconButton
                  type="button"
                  size="s"
                  mode="gray"
                  onClick={swapCities}
                  aria-label="Поменять направление"
                  className="absolute! right-2! top-1/2! -translate-y-1/2! bg-(--tgui--section_bg_color)! shadow-xs!"
                >
                  <ArrowRightLeft size={15} className="text-(--app-info)" />
                </IconButton>
              </div>

              <div role="tablist" aria-label="День поездки" className="mt-1">
                <SegmentedControl>
                  {DAY_SEGMENTS.map((option) => (
                    <SegmentedControl.Item
                      key={option.value}
                      role="tab"
                      selected={day === option.value}
                      aria-selected={day === option.value}
                      onClick={() => {
                        haptic.selection();
                        setDay(option.value);
                      }}
                    >
                      {option.label}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl>
              </div>

              <Button
                size="l"
                stretched
                mode="filled"
                className="mt-1"
                before={<Search size={18} />}
                type="submit"
              >
                Найти поездку
              </Button>
            </form>
        </div>

        {/* Ближайшая бронь: заголовок + статус-пилюля. Загрузка — скелетон,
            ошибка броней лендинг не блокирует — секция тихо скрыта. */}
        {bookings.isLoading ? (
          <div role="status" aria-label="Загрузка поездки">
            <TripCardSkeleton />
          </div>
        ) : (
          !bookings.error &&
          activeBooking && (
            <div className="flex flex-col gap-2">
              <SectionTitle
                title="Ближайшая поездка"
                hint={dayTimeLabel(activeBooking.trip.date, activeBooking.trip.time)}
              />
              <Tappable
                Component="button"
                type="button"
                onClick={() => {
                  haptic.light();
                  navigate(`/trips/${activeBooking.trip.id}`);
                }}
                className="w-full text-left p-3.5 rounded-2xl bg-(--tgui--secondary_fill) border border-(--app-info)/25 cursor-pointer hover:opacity-95 transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="StatusPill shrink-0"
                    data-tone={activeBooking.status === "confirmed" ? "success" : "warning"}
                  >
                    {activeBooking.status === "confirmed" ? "Подтверждено" : "Ожидает подтверждения"}
                  </span>
                  <ChevronRight size={16} className="text-(--app-info)" />
                </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[16px] font-bold text-(--tgui--text_color) truncate">
                    {activeBooking.trip.fromCity} → {activeBooking.trip.toCity}
                  </div>
                  <div className="text-[12px] text-(--tgui--hint_color) flex items-center gap-1 mt-0.5">
                    <span className="truncate">Водитель: {activeBooking.trip.driver.name}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[15px] font-bold text-(--tgui--text_color)">
                    {activeBooking.trip.price * activeBooking.seat} ₽
                  </div>
                  <div className="text-[11px] text-(--tgui--hint_color) font-medium">
                    Цена поездки
                  </div>
                </div>
              </div>
            </Tappable>
            </div>
          )
        )}

        {/* CTA водителю */}
        <Banner
          type="section"
          header="Едете на машине?"
          subheader="Возьмите попутчиков"
          description="Найдите попутчиков в дорогу по области, чтобы разделить путь и совместные расходы на поездку"
          before={
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-(--tgui--secondary_fill) text-(--app-info)">
              <PlusCircle size={22} />
            </div>
          }
        >
          <Button
            size="m"
            mode="filled"
            stretched
            onClick={() => {
              haptic.light();
              navigate("/trips/my/new");
            }}
            before={<PlusCircle size={16} />}
          >
            Создать поездку
          </Button>
        </Banner>

        {/* Популярные направления: сетка карточек (в Section не кладётся —
            Section только для строк), заголовок — общий SectionTitle. */}
        <div className="flex flex-col gap-2">
          <SectionTitle title="Популярные направления" hint="По области" />

          <div className="grid grid-cols-2 gap-2.5">
            {POPULAR_ROUTES.map((route) => (
              <Tappable
                Component="button"
                key={`${route.from}-${route.to}`}
                type="button"
                onClick={() => goToSearch(route.from, route.to, "all")}
                className="text-left p-3 rounded-xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) cursor-pointer hover:border-(--app-info) transition"
              >
                <div className="text-lg mb-1">{route.icon}</div>
                <div className="font-semibold text-[13px] text-(--tgui--text_color) line-clamp-1">
                  {route.from} → {route.to}
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-(--tgui--hint_color)">
                  <span className="font-medium text-(--app-info)">Найти попутку</span>
                </div>
              </Tappable>
            ))}
          </div>
        </div>

        {/* Преимущества: эталон Section + Cell — не трогаем. */}
        <Section header="Преимущества Едем">
            <Cell
              before={
                <div className="icon-circle icon-circle--info">
                  <ShieldCheck size={18} />
                </div>
              }
              subtitle="Верификация через Telegram ID"
            >
              Безопасность и проверка
            </Cell>
            <Cell
              before={
                <div className="icon-circle icon-circle--warning">
                  <Star size={18} />
                </div>
              }
              subtitle="Честные отзывы только после завершённых поездок"
            >
              Честный рейтинг
            </Cell>
            <Cell
              before={
                <div className="icon-circle icon-circle--success">
                  <TrendingUp size={18} />
                </div>
              }
              subtitle="Дешевле, чем автобус или такси между районами области"
            >
              Выгодные цены
            </Cell>
          </Section>

      </div>
    </>
  );
}
