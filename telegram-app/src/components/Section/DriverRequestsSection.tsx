import { useState } from "react";
import {
  ButtonCell,
  IconButton,
  Section,
} from "@telegram-apps/telegram-ui";
import { List, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Booking, DriverBookingAction } from "@edem/contracts";
import {
  useDriverRequestsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";
import { useUserReviewsQuery } from "@/queries/useReviewsQuery";
import { useToast } from "@/components/ToastProvider";
import { PassengerRequestModal } from "@/components/PassengerRequestModal";
import { TripCell } from "@/components/TripCell";
import { formatSeatNumber } from "@/utils/bookingSplit";
import { haptic } from "@/utils/haptics";

/**
 * «Рассмотрите заявки» — сводка pending-заявок водителя по всем его
 * активным поездкам (только нативные компоненты tgui: Section/Cell/
 * Avatar.Badge/IconButton/ButtonCell). Тап по ячейке — страница заявок
 * поездки; тап по «+» — досье пассажира в нижней модалке, где и
 * принимается решение (одобрить/отказать). Секция скрыта, если заявок нет.
 */

const PREVIEW_LIMIT = 3;

export function DriverRequestsSection() {
  const navigate = useNavigate();
  const toast = useToast();
  const requests = useDriverRequestsQuery();
  const updateStatus = useUpdateBookingStatusMutation();

  const [active, setActive] = useState<Booking | null>(null);
  const [pendingAction, setPendingAction] =
    useState<DriverBookingAction | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Отзывы пассажира подгружаются только при открытой модалке.
  const reviews = useUserReviewsQuery(active?.passenger.id ?? "");

  if (requests.error || !requests.data?.length) return null;

  const allRequests = requests.data;
  const visible = expanded ? allRequests : allRequests.slice(0, PREVIEW_LIMIT);

  const decide = (action: DriverBookingAction) => {
    if (!active || pendingAction) return;
    setPendingAction(action);
    updateStatus.mutate(
      { id: active.id, status: action },
      {
        onSuccess: () => {
          haptic.success();
          toast.show({
            text:
              action === "confirmed" ? "Заявка принята" : "Заявка отклонена",
          });
          setPendingAction(null);
          setActive(null);
        },
        onError: () => {
          setPendingAction(null);
          haptic.error();
        },
      },
    );
  };

  return (
    <div>
      <Section header="Рассмотрите заявки">
        {visible.map((booking) => (
          <TripCell
            key={booking.id}
            avatar={{
              src: booking.passenger.avatar,
              name: booking.passenger.name,
              rating: booking.passenger.rating,
            }}
            title={`${booking.trip.fromCity} → ${booking.trip.toCity}`}
            subtitle={booking.passenger.name}
            description={`${booking.trip.price}₽ · ${formatSeatNumber(booking.seat)} · ${booking.trip.date} · ${booking.trip.time}`}
            after={
              <IconButton
                mode="bezeled"
                size="s"
                aria-label={`Открыть заявку ${booking.passenger.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  haptic.light();
                  setActive(booking);
                }}
              >
                <Plus size={20} />
              </IconButton>
            }
            onOpen={() => {
              haptic.light();
              navigate(`/trips/my/${booking.trip.id}/requests`);
            }}
          />
        ))}
        {allRequests.length > PREVIEW_LIMIT && (
          <ButtonCell
            mode="default"
            before={<List size={20} />}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Свернуть" : `Показать все (${allRequests.length})`}
          </ButtonCell>
        )}
      </Section>

      <PassengerRequestModal
        booking={active}
        open={active !== null}
        onClose={() => setActive(null)}
        onDecide={decide}
        busy={pendingAction}
        reviews={reviews.data ?? []}
        reviewsLoading={reviews.isLoading}
      />
    </div>
  );
}
