import { Fragment, useState } from "react";
import { Notice } from "@/ui/Notice";
import { FetchMore } from "@/ui/FetchMore";
import { Button } from "@/ui/Button";
import { Switcher, type SwitcherOption } from "@/ui/Switcher";
import { Page } from "@/ui/Page";
import { Input, VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Search as SearchIcon } from "lucide-react";

import { useNavigate, useSearchParams } from "react-router-dom";
import { TripCard } from "@/components/Trip/TripCard";
import { TripDemandCard } from "@/components/Trip/TripDemandCard";
import { QueryState } from "@/components/QueryState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Stack } from "@/ui/Stack";
import { TripCardsSkeleton, TripCardSkeleton } from "@/components/Skeletons";
import { useToast } from "@/components/Toast/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { haptic } from "@/utils/haptics";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import {
  useCancelBookingMutation,
  useMyBookingsQuery,
} from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useInfiniteMyTripsQuery,
} from "@/queries/useTripsQuery";
import styles from "./TripActivePage.module.css";

type TripSegment = "all" | "driver" | "passenger";

/**
 * Нормализация ?segment: driver ← {driver, driving, requests (legacy)};
 * passenger ← {passenger, bookings (legacy)}; all ← {all, active
 * (legacy), всё остальное}. Не редирект, а нормализация отображения:
 * легаси-ссылки остаются валидными.
 *
 * B7: «driving» — это ДРАЙВЕР, а не алиас «Все». Ровно этот токен шлют
 * три точки входа, и все три имеют в виду «за рулём»: счётчик «Поездки»
 * на главной (TripCountersSection), действия экрана заявок водителя
 * (TripRequestsModal) и deep-link my_trips (deepLinks). Прежний маппинг
 * в «Все» уводил все три не туда. Экспорт — для таблицы токенов в юнит-
 * тесте (рядом с normalizeNotifSegment в NotificationsPage).
 */
export function normalizeSegment(raw: string | null): TripSegment {
  if (raw === "passenger" || raw === "bookings") return "passenger";
  if (raw === "driver" || raw === "requests" || raw === "driving") {
    return "driver";
  }
  return "all";
}

const timeOf = (departureAt?: string): number =>
  departureAt ? Date.parse(departureAt) : 0;

function matchesQuery(
  fromCity: string,
  toCity: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return fromCity.toLowerCase().includes(q) || toCity.toLowerCase().includes(q);
}

/**
 * Активные поездки/брони в стиле кошелька: сверху строка поиска
 * «Откуда → Куда» (живой клиентский фильтр по загруженным спискам),
 * ниже бейджи Все / Водитель / Пассажир (без счётчиков).
 *
 * Все — поездки за рулём и брони одним списком по дате отправления;
 * Водитель — только поездки с заявками (заявки уже развёрнуты внутри
 * TripCard, отдельный сегмент не нужен); Пассажир — брони.
 * Канонический URL — чистый /bookings (= Все).
 */
export function TripActivePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const segment = normalizeSegment(searchParams.get("segment"));
  const [query, setQuery] = useState("");

  const bookings = useMyBookingsQuery();
  const driverActive = useInfiniteMyTripsQuery({ status: "active" });
  const cancelBooking = useCancelBookingMutation();
  const cancelTrip = useCancelTripMutation();

  const mutationError = cancelBooking.error ?? cancelTrip.error;

  // Активные — только scope active: бэкенд метит history завершённые
  // и уехавшие (departureAt <= now), даже если бронь confirmed.
  // scope отсутствует только в старых моках — таких не отфильтровываем.
  const activeBookings = (bookings.data ?? [])
    .filter(
      (booking) =>
        (booking.status === "pending" || booking.status === "confirmed") &&
        booking.scope !== "history" &&
        matchesQuery(booking.trip.fromCity, booking.trip.toCity, query),
    )
    .sort((a, b) => timeOf(a.trip.departureAt) - timeOf(b.trip.departureAt));

  const activeDriverTrips =
    driverActive.data?.pages.flatMap((page) => page.items) ?? [];
  const driverTrips = activeDriverTrips
    .filter((trip) => matchesQuery(trip.fromCity, trip.toCity, query))
    .sort((a, b) => timeOf(a.departureAt) - timeOf(b.departureAt));
  const driverWithRequests = driverTrips.filter(
    (trip) => (trip.pendingRequestsCount ?? 0) > 0,
  );
  // Заявок нигде нет — условие снимаем, показываем все поездки водителя,
  // иначе вкладка необъяснимо пуста.
  const driverList =
    driverWithRequests.length > 0 ? driverWithRequests : driverTrips;

  const SEGMENTS = [
    { value: "all", label: "Все" },
    { value: "driver", label: "Водитель" },
    { value: "passenger", label: "Пассажир" },
  ] as const satisfies ReadonlyArray<SwitcherOption<TripSegment>>;

  const selectSegment = (next: TripSegment) => {
    setSearchParams(next === "all" ? {} : { segment: next }, {
      replace: true,
    });
  };

  const onCancelBooking = (id: string) =>
    cancelBooking.mutate(id, {
      onSuccess: () => {
        haptic.success();
        toast.show({ text: "Бронь поездки отменена" });
      },
    });
  const onCancelTrip = (id: string) =>
    cancelTrip.mutate(id, {
      onSuccess: () => {
        haptic.warning();
        toast.show({ text: "Поездка отменена" });
      },
    });
  const cancelBookingPending = (id: string) =>
    cancelBooking.isPending && cancelBooking.variables === id;
  const cancelTripPending = (id: string) =>
    cancelTrip.isPending && cancelTrip.variables === id;

  // Карточка спроса едет СОСЕДОМ своей поездки, а не внутрь неё: строки
  // заявок — нативные кнопки `ui/MenuRow`, и внутри кликабельной `TripCard`
  // (корневой onClick + кнопка открытия) они оказались бы вложенными
  // интерактивными элементами. Соседями они не конфликтуют: тап по строке
  // сам открывает поездку (см. TripDemandCard).
  //
  // Цена решения — по одному запросу на поездку водителя (у него их единицы,
  // страница ленты берёт по 20). Сводного эндпоинта «спрос по всем моим
  // поездкам» нет, а лимит публичного чтения — 100/мин: на обычном экране
  // это единицы запросов, а не сотня.
  const renderDriving = (trip: (typeof driverTrips)[number]) => (
    <Fragment key={`d-${trip.id}`}>
      <TripCard
        variant={{
          kind: "driving",
          trip,
          onCancel: onCancelTrip,
          cancelPending: cancelTripPending(trip.id),
        }}
      />
      {/* seatsAvailable — из той же поездки: приглашать некого, когда мест
          нет, и проверять это отдельным запросом незачем. */}
      <TripDemandCard tripId={trip.id} seatsAvailable={trip.seatsAvailable} />
      {/* Пин «подбор выключен». Без него молчание карточки спроса неотличимо
          от «спроса нет»: водитель, выключивший подбор, видел бы пустое место
          и не понимал бы, что это его выбор, а не отсутствие людей.

          Строгое `=== false`, а не «не true»: неизвестное значение ≠ выключено
          (MEMORY §18). На старом/замоканном ответе флага нет — и «угадывать»
          его как «выключено» значило бы врать водителю.

          Текст отвечает на оба вопроса, которые иначе остаются без ответа:
          что произойдёт, если включить обратно, и что поездка всё равно
          видна пассажирам обычным поиском (скрытия из поиска нет и не
          обещается). Рендерится соседом своей поездки и только в ветке
          водителя — на пассажирских карточках такого блока быть не может. */}
      {trip.matchingEnabled === false ? (
        <Notice tone="info" variant="text">
          Подбор попутчиков выключен. Никто не получит уведомление о вашей
          поездке — но поездка по-прежнему находится обычным поиском, и на неё
          смогут записаться сами.
        </Notice>
      ) : null}
    </Fragment>
  );
  const renderBooking = (booking: (typeof activeBookings)[number]) => (
    <TripCard
      key={`b-${booking.id}`}
      variant={{
        kind: "booking",
        booking,
        onCancel: onCancelBooking,
        cancelPending: cancelBookingPending(booking.id),
      }}
    />
  );

  const activeSentinelRef = useInfiniteSentinel({
    hasNextPage: driverActive.hasNextPage,
    isFetchingNextPage: driverActive.isFetchingNextPage,
    fetchNextPage: () => {
      void driverActive.fetchNextPage();
    },
  });

  const searching = query.trim() !== "";
  // Все: поездки и брони одним списком по дате отправления.
  const allCards = [
    ...driverTrips.map((trip) => ({
      time: timeOf(trip.departureAt),
      node: renderDriving(trip),
    })),
    ...activeBookings.map((booking) => ({
      time: timeOf(booking.trip.departureAt),
      node: renderBooking(booking),
    })),
  ].sort((a, b) => a.time - b.time);

  const emptyHeader = searching
    ? EMPTY_STATES.searchNoResults.header
    : undefined;
  const emptyText = searching
    ? EMPTY_STATES.searchNoResults.description
    : EMPTY_STATES.tripActive.description;

  return (
    <Page>
      {/* NavHeader помечен aria-hidden («авторитетные h1 живут на страницах») —
          имя экрана даёт скрытый h1. */}
      <VisuallyHidden Component="h1">Поездки</VisuallyHidden>
      {mutationError && (
        <Notice tone="danger" variant="text">
          {bookingErrorMessage(mutationError)}
        </Notice>
      )}
      <div className={styles.searchRow}>
        <Input
          id="bookings-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск"
          before={<SearchIcon size={17} aria-hidden />}
          aria-label="Поиск по откуда и куда"
          className={styles.searchField}
        />
      </div>
      <Switcher
        options={SEGMENTS}
        value={segment}
        onChange={selectSegment}
        ariaLabel="Сегмент поездок"
        idPrefix="booking-segment"
      />
      {segment === "passenger" ? (
        <QueryState
          loading={bookings.isLoading}
          error={bookings.error}
          empty={activeBookings.length === 0}
          emptyHeader={emptyHeader}
          emptyText={emptyText}
          emptyAction={
            !searching ? (
              <Button
                size="m"
                onClick={() => {
                  haptic.light();
                  navigate("/profile/history");
                }}
              >
                История поездок
              </Button>
            ) : undefined
          }
          skeleton={<TripCardsSkeleton />}
          onRetry={() => {
            void bookings.refetch();
          }}
        >
          <Stack>{activeBookings.map(renderBooking)}</Stack>
        </QueryState>
      ) : segment === "driver" ? (
        <QueryState
          loading={driverActive.isLoading}
          error={driverActive.error}
          empty={driverList.length === 0}
          emptyHeader={emptyHeader}
          emptyText={emptyText}
          emptyAction={
            !searching ? (
              <Button
                size="m"
                onClick={() => {
                  haptic.light();
                  navigate("/profile/history");
                }}
              >
                История поездок
              </Button>
            ) : undefined
          }
          skeleton={<TripCardsSkeleton />}
          onRetry={() => {
            void driverActive.refetch();
          }}
        >
          <Stack>
            {driverList.map(renderDriving)}
            <FetchMore
              hasNextPage={driverActive.hasNextPage}
              isFetchingNextPage={driverActive.isFetchingNextPage}
              fetchNextPage={() => void driverActive.fetchNextPage()}
              sentinelRef={activeSentinelRef}
              placeholder={<TripCardSkeleton />}
              placeholderLabel="Загрузка ещё поездок"
            />
          </Stack>
        </QueryState>
      ) : (
        <QueryState
          loading={driverActive.isLoading || bookings.isLoading}
          error={driverActive.error ?? bookings.error}
          empty={allCards.length === 0}
          emptyHeader={emptyHeader}
          emptyText={emptyText}
          emptyAction={
            !searching ? (
              <Button
                size="m"
                onClick={() => {
                  haptic.light();
                  navigate("/profile/history");
                }}
              >
                История поездок
              </Button>
            ) : undefined
          }
          skeleton={<TripCardsSkeleton />}
          onRetry={() => {
            void driverActive.refetch();
            void bookings.refetch();
          }}
        >
          <Stack>
            {allCards.map((card) => card.node)}
            <FetchMore
              hasNextPage={driverActive.hasNextPage}
              isFetchingNextPage={driverActive.isFetchingNextPage}
              fetchNextPage={() => void driverActive.fetchNextPage()}
              sentinelRef={activeSentinelRef}
              placeholder={<TripCardSkeleton />}
              placeholderLabel="Загрузка ещё поездок"
            />
            <Button size="l" onClick={() => navigate("/trips")}>
              Найти поездку
            </Button>
            <Button size="l" onClick={() => navigate("/trips/my/new")}>
              + Создать поездку
            </Button>
          </Stack>
        </QueryState>
      )}
    </Page>
  );
}
