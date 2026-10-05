import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hapticFeedback } from "@tma.js/sdk-react";
import type { Trip } from "@edem/contracts";
import { ApiError } from "@/api/client";
import { useToast } from "@/components/Toast/ToastProvider";
import { shareTrip } from "@/helpers/tripShare";
import { TRIP_KEYS } from "@/queries/useTripsQuery";
import { useCreateBookingMutation } from "@/queries/useBookingsQuery";
import { useAuthStore } from "@/store/useAuthStore";
import { formatArrivalTime } from "@/utils/date";

export type CreateBookingMutation = ReturnType<
  typeof useCreateBookingMutation
>;

/** Верхняя граница setTimeout (int32); всё дальше — переполнение в 0. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Состояние и хендлеры TripDetails: выбор места, комментарий, режим
 * редактирования, шаринг, бронирование + производные флаги (canBook,
 * departed, …). Вынесено из TripDetailsPage — страница отдаёт разметку
 * подкомпонентам, логика одна на всех.
 *
 * NB: хук обязан вызываться до ранних return страницы (rules-of-hooks),
 * поэтому item опционален — пока данных нет, флаги дефолтные.
 */
export function useTripActions(item: Trip | undefined) {
  const user = useAuthStore((state) => state.user);
  const toast = useToast();
  const queryClient = useQueryClient();
  const createBooking = useCreateBookingMutation();
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  // Снимок «сейчас» на момент монтирования (lazy-инициализатор — Date.now()
  // напрямую в рендере запрещён react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());

  const isDriver = item ? item.driver.id === user?.id : false;
  const departureTime =
    item?.departureAt != null ? new Date(item.departureAt).getTime() : null;

  // Граница отправления ДОЛЖНА наступить, пока страница открыта. Снимок
  // now на маунте больше не менялся, поэтому водитель, открывший поездку
  // ДО departureAt, не мог нажать «Завершить поездку» до перезагрузки:
  // canCompleteTrip — чисто клиентский гейт, сервер тут не страхует (у
  // canBook есть TRIP_IN_PAST). Обновляемся ОДИН раз, точно на границе,
  // а не интервалом: открытая страница не должна ререндерить раз в минуту
  // ради одного перехода.
  useEffect(() => {
    if (departureTime === null || departureTime <= now) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      // setTimeout за пределами int32 переполняется и срабатывает СРАЗУ —
      // таймер на «через месяц» нельзя вешать напрямую.
      Math.min(departureTime - now, MAX_TIMEOUT_MS),
    );
    return () => window.clearTimeout(timer);
  }, [departureTime, now]);
  const departed = departureTime !== null && departureTime <= now;
  const isActive = !item?.status || item.status === "active";
  const hasActiveBooking =
    !!item?.myBooking &&
    item.myBooking.status !== "cancelled" &&
    item.myBooking.status !== "declined";
  const isConfirmedBooking = item?.myBooking?.status === "confirmed";
  // Телефон водителя (F1): сервер отдаёт его только подтверждённому
  // пассажиру (и водителю). Pending-заявитель видит disabled-хинт,
  // посторонние — ничего.
  const canBook =
    !!item &&
    !isDriver &&
    isActive &&
    item.seatsAvailable > 0 &&
    !hasActiveBooking &&
    departureTime !== null &&
    departureTime > now;

  const takenSeats = item?.bookedSeats ?? [];
  const availableSeats = item
    ? Array.from(
        { length: item.seatsTotal },
        (_, index) => index + 1,
      ).filter((seat) => !takenSeats.includes(seat))
    : [];
  const effectiveSeat =
    selectedSeat !== null && !takenSeats.includes(selectedSeat)
      ? selectedSeat
      : (availableSeats[0] ?? null);

  const canCompleteTrip =
    isDriver && isActive && departureTime !== null && departureTime <= now;
  const arrival = item ? formatArrivalTime(item.time, item.durationMinutes) : "";

  const handleShare = (tripId: string) => {
    setShareStatus(null);
    void shareTrip(tripId).then((result) => {
      if (result === "shared")
        setShareStatus("Ссылка отправлена — поделитесь поездкой с попутчиками");
      else if (result === "copied")
        setShareStatus(
          "Ссылка скопирована — поделитесь поездкой с попутчиками",
        );
      else
        setShareStatus(
          "Не удалось поделиться — скопируйте адрес страницы вручную",
        );
      hapticFeedback.notificationOccurred.ifAvailable("success");
    });
  };

  const toggleEditing = () => setEditing((value) => !value);

  const submitBooking = () => {
    if (!item || effectiveSeat === null) return;
    const tripId = item.id;
    const seat = effectiveSeat;
    const trimmed = comment.trim();
    createBooking.mutate(
      {
        tripId,
        seat,
        comment: trimmed ? trimmed : undefined,
      },
      {
        onSuccess: () => {
          hapticFeedback.notificationOccurred.ifAvailable("success");
          setComment("");
          toast.show({
            text: "Место успешно забронировано",
            description: "Ожидайте подтверждения от водителя",
          });
        },
        onError: (error) => {
          // Гонка за место: обновляем схему мест с сервера.
          if (error instanceof ApiError && error.code === "SEAT_TAKEN") {
            void queryClient.invalidateQueries({
              queryKey: TRIP_KEYS.detail(tripId),
            });
          }
        },
      },
    );
  };

  return {
    now,
    isDriver,
    departed,
    isActive,
    hasActiveBooking,
    isConfirmedBooking,
    canBook,
    takenSeats,
    effectiveSeat,
    canCompleteTrip,
    arrival,
    selectedSeat,
    setSelectedSeat,
    comment,
    setComment,
    editing,
    toggleEditing,
    shareStatus,
    handleShare,
    createBooking,
    submitBooking,
  };
}

export type TripActions = ReturnType<typeof useTripActions>;
