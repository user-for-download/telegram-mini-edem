import { useNavigate } from "react-router-dom";
import type { Trip } from "@edem/contracts";
import {
  StatusPill,
  type StatusTone,
} from "@/components/StatusPill/StatusPill";
import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { haptic } from "@/utils/haptics";

/** Пилюля мест для публичной ленты: занятость — единственный «статус». */
function seatsLabel(trip: Trip): { label: string; tone: StatusTone } {
  if (trip.seatsAvailable === 0) return { label: "Мест нет", tone: "danger" };
  return {
    label: `Осталось мест: ${trip.seatsAvailable}`,
    tone: trip.seatsAvailable <= 1 ? "warning" : "success",
  };
}

/**
 * Карточка поездки в ленте поиска — тонкая обёртка над эталоном
 * TripStandardCard (вкладка «Поездки»): раскладка, маршрут и персона
 * общие, отличается только наполнение публичного ответа (пилюля мест
 * вместо статуса брони, водитель вместо персоны роли).
 *
 * TODO: вернуть иконки тегов и шильд верификации водителя, когда
 * TripStandardCard получит отдельные слоты под них. Пока — осознанно
 * не переносим (унификация важнее).
 */
export function TripFeedCard({ trip }: { trip: Trip }) {
  const navigate = useNavigate();
  const seats = seatsLabel(trip);
  const car = trip.driver.car
    ? `${trip.driver.car.model} · ${trip.driver.car.color}`
    : "Водитель";

  return (
    <TripStandardCard
      tripId={trip.id}
      fromCity={trip.fromCity}
      toCity={trip.toCity}
      fromAddress={trip.fromAddress}
      toAddress={trip.toAddress}
      departureAt={trip.departureAt}
      price={trip.price}
      headerStatus={<StatusPill tone={seats.tone}>{seats.label}</StatusPill>}
      person={{
        name: trip.driver.name,
        avatar: trip.driver.avatar,
        rating: trip.driver.rating,
        subtitle: car,
        showCarIcon: Boolean(trip.driver.car),
      }}
      onOpen={(id) => {
        haptic.light();
        navigate(`/trips/${id}`);
      }}
    />
  );
}
