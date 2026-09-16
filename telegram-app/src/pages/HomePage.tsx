import { useState, type SubmitEvent } from "react";
import {
  Avatar,
  Banner,
  Button,
  Cell,
  Section,
  Tappable,
  Badge,
  Caption,
  Subheadline,
  Info
} from "@telegram-apps/telegram-ui";
import {
  PlusCircle,
  Search,
  ShieldCheck,
  Star,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusPill } from "@/components/StatusPill";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ProfileBarSkeleton } from "@/components/Skeletons";
import { TripCardSkeleton } from "@/components/Skeletons";
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
    .filter((booking) => booking.status === "confirmed" || booking.status === "pending")
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
    <>
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
        {/* Профиль: тело секции без заголовка (поверхность — Section).
            Ошибка профиля лендинг не блокирует — тихий фолбэк. */}
        {profile.isLoading ? (
          <ProfileBarSkeleton />
        ) : (
          <Section>
            {/* Тап по профиль-бару — вкладка профиля (паттерн Tappable
                баннера ближайшей брони ниже). Ошибка профиля переходу
                не мешает — страница профиля отработает свои состояния сама. */}
            <Tappable
              Component="button"
              type="button"
              onClick={() => {
                haptic.light();
                navigate("/profile");
              }}
              aria-label="Открыть профиль"
              className="block w-full text-left"
            >
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
            </Tappable>
          </Section>
        )}

        {/* Экспресс-поиск: города — CityPickerField с автодополнением
            из справочника БД (как на создании поездки). Пикеры — прямые
            дети Section (дивайдеры ставит сама Section), у каждого свой
            видимый label (видно везде, включая iOS). Swap здесь нет:
            absolute-оверлей несовместим с Multiselect, экспресс-форма
            минимальна (swap остался на создании поездки). Сегментов дня
            нет — пресет на /trips без дат (все даты), частичное имя
            ищется contains-поиском бэкенда. Кнопка — в footer секции
            (не в children: иначе Section поставила бы дивайдер), овальная
            за счёт utilities-слоя поверх tgui (без !important). */}
        <form onSubmit={submitSearch}>
          <Section
            header="Куда поедем?"
            footer={
              <div className="p-4">
                <Button
                  size="l"
                  stretched
                  mode="bezeled"
                  before={<Search size={18} />}
                  type="submit"
                  className="rounded-full"
                >
                  Найти поездку
                </Button>
              </div>
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

        {/* Ближайшая бронь: поверхность — Section, статус-пилюля внутри.
            Загрузка — скелетон, ошибка броней лендинг не блокирует. */}
        {bookings.isLoading ? (
          <Section header="Ближайшая поездка">
            <div className="p-4" role="status" aria-label="Загрузка поездки">
              <TripCardSkeleton />
            </div>
          </Section>
        ) : (
          !bookings.error &&
          activeBooking && (
              <Section header="Ближайшая поездка"
              >
                {/* Cell — настоящей кнопкой (Component="button"): голый onClick
                    рендерит div без клавиатуры и без анонса скринридером. */}
                <Cell
                  Component="button"
                  type="button"
                  subhead={
                    <Badge
                      mode="white"
                      type="number"
                    >
                      {activeBooking.status === "confirmed" ? "Подтверждено" : "Ожидает подтверждения"}
                    </Badge>
                }
                onClick={() => {
                  haptic.light();
                  navigate(`/trips/${activeBooking.trip.id}`);
                }}
                  subtitle={
                    <Caption
                      level="1"
                      weight="3"
                    >
                      {activeBooking.trip.driver.car
                        ? `${activeBooking.trip.driver.car.model} · ${activeBooking.trip.driver.name}`
                        : activeBooking.trip.driver.name}
                    </Caption>

                  }
                  description={
                    <Subheadline
                      level="1"
                      weight="3"
                    >
                      { `${activeBooking.trip.date} · ${activeBooking.trip.time}` }
                    </Subheadline>

                  }
                before={
                  <Avatar
                    src={activeBooking.trip.driver.avatar}
                    size={48}
                    acronym={(activeBooking.trip.driver.name ?? "?").slice(0, 2).toUpperCase()}
                  />
                }
                  after={
                  <>
                    <Info
                      subtitle={`${activeBooking.seat} ${activeBooking.seat === 1 ? "место" : "места"}`}
                      type="text"
                    >
                      <span className="font-bold text-(--tgui--text_color)">
                        {activeBooking.trip.price * activeBooking.seat} ₽
                      </span>
                      </Info>
                  </>

                }
              >
                {activeBooking.trip.fromCity} → {activeBooking.trip.toCity}
              </Cell>
            </Section>
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
            mode="bezeled"
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

        {/* Популярные направления: сетка мини-карточек — единственный
            ребёнок Section (дивайдеров нет), поверхность — нативная. */}
        <Section header="Популярные направления">
          <div className="grid grid-cols-2 gap-2.5 p-4">
            {POPULAR_ROUTES.map((route) => (
              <Tappable
                Component="button"
                key={`${route.from}-${route.to}`}
                type="button"
                onClick={() => goToSearch(route.from, route.to)}
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
        </Section>

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
