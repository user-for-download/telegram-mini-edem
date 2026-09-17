import { useState } from "react";
import {
  Avatar,
  ButtonCell,
  Cell,
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
import { formatSeats } from "@/utils/bookingSplit";
import { haptic } from "@/utils/haptics";

/**
 * «Заявки на поездки» — сводка pending-заявок водителя по всем его
 * активным поездкам (только нативные компоненты tgui: Section/Cell/
 * Avatar.Badge/IconButton/ButtonCell). Тап по ячейке — страница заявок
 * поездки; тап по «+» — досье пассажира в нижней модалке, где и
 * принимается решение (одобрить/отказать). Секция скрыта, если заявок нет.
 */

const PREVIEW_LIMIT = 3;
const REVIEWS_PREVIEW = 2;

export function DriverRequestsSection() {
  const navigate = useNavigate();
  const toast = useToast();
  const requests = useDriverRequestsQuery();
  const updateStatus = useUpdateBookingStatusMutation();

  const [active, setActive] = useState<Booking | null>(null);
  const [pendingAction, setPendingAction] = useState<DriverBookingAction | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);

  // Отзывы пассажира подгружаются только при открытой модалке.
  const reviews = useUserReviewsQuery(active?.passenger.id ?? "", {
    enabled: Boolean(active),
  });

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
            text: action === "confirmed" ? "Заявка принята" : "Заявка отклонена",
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
    <>
      <Section header="Заявки на поездки">
        {visible.map((booking) => (
          <Cell
            key={booking.id}
            type="button"
            onClick={() => {
              haptic.light();
              navigate(`/trips/my/${booking.trip.id}/requests`);
            }}
            before={
              <Avatar
                size={48}
                src={booking.passenger.avatar}
                acronym={booking.passenger.name.slice(0, 2).toUpperCase()}
              >
                <Avatar.Badge large type="number">
                  {booking.passenger.rating.toFixed(1)}
                </Avatar.Badge>
              </Avatar>
            }
            subtitle={`${booking.trip.date} · ${booking.trip.time} · ${formatSeats(booking.seat)}`}
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
          >
            {`${booking.trip.fromCity} → ${booking.trip.toCity}`}
          </Cell>
        ))}
        {allRequests.length > PREVIEW_LIMIT && (
          <ButtonCell
            mode="default"
            before={<List size={20} />}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? "Свернуть"
              : `Показать все (${allRequests.length})`}
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
    </>
  );
}