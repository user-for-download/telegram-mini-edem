import { IconButton } from "@/ui/IconButton";
import { Share2 } from "lucide-react";
import { useOpenTrip } from "@/hooks/useOpenTrip";
import {
  StatusPill,
  type StatusTone,
} from "@/components/StatusPill/StatusPill";
import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { DriverTripRequests } from "@/components/Trip/DriverTripRequests";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { ICON_TARGET, MIN_TARGET } from "@/ui/classes";
import { shareOutcomeFeedback, shareTrip } from "@/helpers/tripShare";
import { useToast } from "@/components/Toast/ToastProvider";
import { useAuthStore } from "@/store/useAuthStore";
import { haptic } from "@/utils/haptics";
import type { PassengerBooking, Trip } from "@edem/contracts";
import styles from "./TripCards.module.css";

function bookingStatusLabel(status: string): {
  label: string;
  tone: StatusTone;
} {
  if (status === "confirmed") return { label: "Подтверждено", tone: "success" };
  if (status === "cancelled") return { label: "Отменено", tone: "danger" };
  if (status === "declined") return { label: "Отклонено", tone: "danger" };
  return { label: "На рассмотрении", tone: "warning" };
}

function tripStatusLabel(trip: Trip): { label: string; tone: StatusTone } {
  if (trip.status === "completed") return { label: "Завершена", tone: "info" };
  if (trip.status === "cancelled") return { label: "Отменена", tone: "danger" };
  const pending = trip.pendingRequestsCount ?? 0;
  if (pending > 0) return { label: `Заявки: ${pending}`, tone: "warning" };
  const confirmed = trip.confirmedBookingsCount ?? 0;
  // Коротко — «Занято 1 из 3», а не «Забронировано: 1/3»: длинная плашка
  // не помещалась рядом с датой и уезжала на вторую строку, из-за чего
  // шапки соседних карточек стояли на разной высоте.
  if (confirmed > 0)
    return {
      label: `Занято ${confirmed} из ${trip.seatsTotal}`,
      tone: "info",
    };
  return { label: `Свободно ${trip.seatsAvailable}`, tone: "success" };
}

export type TripCardVariant =
  | {
      kind: "booking";
      booking: PassengerBooking;
      onCancel: (id: string) => void;
      cancelPending: boolean;
    }
  | {
      kind: "driving";
      trip: Trip;
      onCancel: (id: string) => void;
      cancelPending: boolean;
    };

/**
 * Отмена доступна только для отменяемых статусов (active) И до отправления.
 * Статус в контракте опционален — поездка без статуса считается
 * активной (легаси-данные), кнопку скрываем только для терминальных
 * cancelled/completed.
 *
 * `departureAt` — тоже гейт: автоархив наступает лишь через 24ч после
 * отправления, поэтому уехавшая поездка ещё долго остаётся `active` с живой
 * кнопкой отмены, которую бэкенд всё равно отклоняет (409 TRIP_IN_PAST).
 */
function isCancellable(trip: Trip, now: Date = new Date()): boolean {
  if (trip.status === "cancelled" || trip.status === "completed") return false;
  const departureAt = Date.parse(trip.departureAt ?? "");
  if (Number.isFinite(departureAt) && departureAt <= now.getTime())
    return false;
  return true;
}

/**
 * Единая карточка поездки (стандарт вкладки): шапка дата — статус — цена,
 * маршрут, персона. Отличие одно:
 * - пассажир: Cell водителя;
 * - водитель без заявок: «Вы водитель»;
 * - водитель с заявками: строки заявок с −/+ вместо персоны.
 * Футер — группа у правого края: поделиться + «Отменить бронь»
 * (бронь) / «Отменить поездку» (своя, только для отменяемых статусов).
 * В детали ведёт тап по самой карточке (onOpen) — отдельной кнопки нет.
 */
export function TripCard({ variant }: { variant: TripCardVariant }) {
  const openTrip = useOpenTrip();
  const toast = useToast();
  const share = async (tripId: string) => {
    const feedback = shareOutcomeFeedback(await shareTrip(tripId));
    if (feedback.haptic) haptic[feedback.haptic]();
    toast.show({
      text: feedback.text,
      tone: feedback.haptic === "error" ? "error" : feedback.haptic ? "success" : "info",
    });
  };
  // Своя строка «Вы водитель» показывает собственный аватар: «ВЫ» из
  // первых двух букв имени читалось как ошибка инициалов. Хранилище может
  // быть пустым (SSR/тесты) — тогда аватар деградирует до акронима.
  const me = useAuthStore((state) => state.user);

  if (variant.kind === "booking") {
    const { booking, onCancel, cancelPending } = variant;
    const status = bookingStatusLabel(booking.status);
    const driver = booking.trip.driver;
    const car = driver.car
      ? `${driver.car.model} · ${driver.car.color}`
      : "Водитель";
    // Адреса — только подтверждённым (публичные ответы их маскируют).
    const confirmed = booking.status === "confirmed";
    // Строка персоны у брони описывает ВОДИТЕЛЯ: машина и цвет. Свое место
    // («место №N») сюда не пишем — это данные пассажира, и в строке про
    // водителя они читались как его характеристика. Место живёт в деталях
    // поездки (BookingPanel: «Место №N · цена») и при выборе места.
    const driverLine = car;
    return (
      <TripStandardCard
        tripId={booking.trip.id}
        fromCity={booking.trip.fromCity}
        toCity={booking.trip.toCity}
        fromAddress={confirmed ? booking.trip.fromAddress : null}
        toAddress={confirmed ? booking.trip.toAddress : null}
        departureAt={booking.trip.departureAt}
        price={booking.trip.price}
        headerStatus={
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        }
        person={{
          // Водитель — чужой пользователь: id открывает шторку профиля.
          // Счётчики настоящие, из объекта водителя: initial шторки не
          // имеет права выдумывать «поездок: 0» (M3 аудита).
          id: driver.id,
          name: driver.name,
          avatar: driver.avatar,
          rating: driver.rating,
          reviewsCount: driver.reviewsCount,
          tripsCount: driver.tripsCount,
          subtitle: driverLine,
          showCarIcon: Boolean(driver.car),
        }}
        onOpen={(id) => {
          haptic.light();
          openTrip(id);
        }}
        footer={
          // Группа действий у правого края: поделиться + отмена.
          // Всплытие гасят сами кнопки — обёртка с onClick запрещена jsx-a11y.
          <div className={styles.footerEnd}>
            <IconButton
              variant="outline"
              size="s"
              aria-label="Поделиться поездкой"
              title="Поделиться поездкой"
              // Тап-таргет: size="s" у кита — это padding 6px + иконка 15px,
              // то есть ~27×27px. ICON_TARGET (44×44, круг) поднимает и
              // высоту, и ширину: min-height-only делал из круга овал, а
              // иконку прижимал к верху.
              className={ICON_TARGET}
              onClick={(event) => {
                event.stopPropagation();
                haptic.light();
                void share(booking.trip.id);
              }}
            >
              <Share2 size={15} />
            </IconButton>
            {(booking.status === "pending" ||
              booking.status === "confirmed") && (
              <div className={styles.cancelRight}>
                <ConfirmPopup
                  label="Отменить бронь"
                  confirmLabel="Отменить бронь"
                  description="Заявка будет отменена, а место снова станет доступно."
                  pending={cancelPending}
                  destructive
                  mode="outline"
                  className={MIN_TARGET}
                  onConfirm={() => onCancel(booking.id)}
                />
              </div>
            )}
          </div>
        }
      />
    );
  }

  const { trip, onCancel, cancelPending } = variant;
  const status = tripStatusLabel(trip);
  const pending = trip.pendingRequestsCount ?? 0;
  // Футер одинаковый для обеих ролей: поделиться + отмена у правого края.
  // Завершить/управление живут в деталях поездки (тап по карточке).
  return (
    <TripStandardCard
      tripId={trip.id}
      fromCity={trip.fromCity}
      toCity={trip.toCity}
      fromAddress={trip.fromAddress}
      toAddress={trip.toAddress}
      departureAt={trip.departureAt}
      price={trip.price}
      headerStatus={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      person={{
        name: "Вы водитель",
        avatar: me?.avatar ?? null,
        subtitle: `Пассажиры: ${trip.confirmedBookingsCount ?? trip.seatsTotal - trip.seatsAvailable}`,
        passengers: trip.passengers ?? [],
      }}
      // Есть активные заявки — вместо «Вы водитель» строки заявок с −/+.
      personOverride={
        pending > 0 ? <DriverTripRequests tripId={trip.id} /> : undefined
      }
      onOpen={(id) => {
        haptic.light();
        openTrip(id);
      }}
      footer={
        // Группа действий у правого края: поделиться + отмена.
        // Всплытие гасят сами кнопки — обёртка с onClick запрещена jsx-a11y.
        <div className={styles.footerEnd}>
          <IconButton
            variant="outline"
            size="s"
            aria-label="Поделиться поездкой"
            title="Поделиться поездкой"
            // ICON_TARGET — тот же приём, что у кнопки отмены рядом и у
            // «принять/отклонить» в DriverTripRequests: 44×44 круг, а не
            // 27×44 овал с иконкой у верхнего края.
            className={ICON_TARGET}
            onClick={(event) => {
              event.stopPropagation();
              haptic.light();
              void share(trip.id);
            }}
          >
            <Share2 size={15} />
          </IconButton>
          {isCancellable(trip) && (
            <div className={styles.cancelRight}>
              <ConfirmPopup
                label="Отменить поездку"
                confirmLabel="Отменить поездку"
                description="Поездка станет недоступна, а пассажиры получат уведомление."
                pending={cancelPending}
                destructive
                mode="outline"
                className={MIN_TARGET}
                onConfirm={() => onCancel(trip.id)}
              />
            </div>
          )}
        </div>
      }
    />
  );
}
