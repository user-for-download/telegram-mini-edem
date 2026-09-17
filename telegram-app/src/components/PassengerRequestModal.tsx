import {
  Avatar,
  Button,
  Caption,
  Headline,
  Modal,
  Section,
  Skeleton,
  Text,
} from "@telegram-apps/telegram-ui";
import { Star, X } from "lucide-react";
import type { Booking, DriverBookingAction, Review } from "@edem/contracts";
import { formatSeatNumber } from "@/utils/bookingSplit";

/**
 * Досье пассажира в нижней модалке (vaul): аватар с бейджем рейтинга,
 * статистика, маршрут и 2 последних отзыва, решение — «Одобрить/Отказать».
 * Тело экспортировано отдельно для SSR-тестов: Modal — портал и в
 * renderToString не попадает (паттерн FeedbackModal).
 */

export interface PassengerRequestModalProps {
  booking: Booking | null;
  open: boolean;
  /** Закрытие свайпом/крестиком/оверлеем. */
  onClose: () => void;
  /** Решение водителя; busy — какой статус сейчас применяется. */
  onDecide: (action: DriverBookingAction) => void;
  busy: DriverBookingAction | null;
  reviews: Review[];
  reviewsLoading: boolean;
}

export function PassengerRequestModal({
  booking,
  open,
  onClose,
  onDecide,
  busy,
  reviews,
  reviewsLoading,
}: PassengerRequestModalProps) {
  return (
    <Modal
      open={open && booking !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {booking && (
        <>
          <Modal.Header
            after={
              <Modal.Close>
                <X style={{ color: "var(--tgui--plain_foreground)" }} />
              </Modal.Close>
            }
          >
            Заявка на поездку
          </Modal.Header>
          <PassengerRequestModalBody
            booking={booking}
            onDecide={onDecide}
            busy={busy}
            reviews={reviews}
            reviewsLoading={reviewsLoading}
          />
        </>
      )}
    </Modal>
  );
}

interface BodyProps {
  booking: Booking;
  onDecide: (action: DriverBookingAction) => void;
  busy: DriverBookingAction | null;
  reviews: Review[];
  reviewsLoading: boolean;
}

export function PassengerRequestModalBody({
  booking,
  onDecide,
  busy,
  reviews,
  reviewsLoading,
}: BodyProps) {
  const { passenger, trip } = booking;
  // В досье пассажира показываем отзывы именно о нём как о пассажире.
  const passengerReviews = reviews
    .filter((review) => review.targetRole === "passenger")
    .slice(0, 2);

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-2 pb-10">
      {/* Досье */}
      <div className="flex items-center gap-3">
        <Avatar
          size={96}
          src={passenger.avatar}
          acronym={passenger.name.slice(0, 2).toUpperCase()}
        >
          <Avatar.Badge large type="number">
            {passenger.rating.toFixed(1)}
          </Avatar.Badge>
        </Avatar>
        <div className="flex flex-col gap-1">
          <Headline weight="2">{passenger.name}</Headline>
          <Caption>
            {`★ ${passenger.rating.toFixed(1)} · ${passenger.tripsCount} поездок · ${passenger.reviewsCount} отзывов`}
          </Caption>
        </div>
      </div>

      {/* Маршрут */}
      <Section>
        <Section.Header>Поездка</Section.Header>
        <Text>
          {`${trip.fromCity} → ${trip.toCity}`}
        </Text>
        <Caption>
          {`${trip.date} · ${trip.time} · ${formatSeatNumber(booking.seat)} · ${trip.price} ₽`}
        </Caption>
        {booking.comment && <Caption>Комментарий: {booking.comment}</Caption>}
      </Section>

      {/* Последние отзывы о пассажире */}
      <Section header="Последние отзывы">
        {reviewsLoading ? (
          <Skeleton visible withoutAnimation>
            <Caption>Загрузка отзывов…</Caption>
          </Skeleton>
        ) : passengerReviews.length === 0 ? (
          <Caption>Отзывов пока нет</Caption>
        ) : (
          passengerReviews.map((review) => (
            <div key={review.id} className="flex items-start gap-2">
              <Star size={14} />
              <div className="flex flex-col">
                <Caption>{`${review.rating} · ${review.tripRoute} · ${review.date}`}</Caption>
                <Text>{review.text}</Text>
              </div>
            </div>
          ))
        )}
      </Section>

      {/* Решение */}
      <Button
        size="l"
        stretched
        mode="filled"
        disabled={busy !== null}
        onClick={() => onDecide("confirmed")}
      >
        Одобрить заявку
      </Button>
      <Button
        size="l"
        stretched
        mode="bezeled"
        disabled={busy !== null}
        style={{ color: "var(--tgui--destructive_text_color)" }}
        onClick={() => onDecide("declined")}
      >
        Отказать
      </Button>
    </div>
  );
}