import type { PassengerBooking } from "@edem/contracts";
import { TripCard } from "@/components/Trip/TripCard";

/**
 * Легаси-обёртка для TripsPage: карточка активной брони пассажира.
 * Новый код использует TripCard напрямую.
 */
export function ActiveBookingCard({
  booking,
  onCancel,
  pending,
}: {
  booking: PassengerBooking;
  onCancel: (id: string) => void;
  pending: boolean;
}) {
  return (
    <TripCard
      variant={{ kind: "booking", booking, onCancel, cancelPending: pending }}
    />
  );
}
