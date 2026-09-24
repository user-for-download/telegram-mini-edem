import {
  Avatar,
  Caption,
  Headline,
  Modal,
  Section,
  Skeleton,
  Placeholder,
  Cell,
  Blockquote,
  Badge,
  Breadcrumbs,
  Banner,
  List,
  IconContainer,
} from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";

import { CarFront, X } from "lucide-react";
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
  // Динамический заголовок (маршрут заявки): связку «скрытый h2 +
  // видимый заголовок + aria-labelledby» держит ui/Sheet (SheetTitle внутри).
  const title = booking
    ? `Заявка · ${booking.trip.fromCity} → ${booking.trip.toCity}`
    : "Заявка";
  return (
    <Sheet
      open={open && booking !== null}
      onClose={onClose}
      title={title}
      variant="edge"
      headerAfter={
        <Modal.Close>
          <X style={{ color: "var(--tgui--plain_foreground)" }} />
        </Modal.Close>
      }
    >
      {booking && (
        <PassengerRequestModalBody
          booking={booking}
          onDecide={onDecide}
          busy={busy}
          reviews={reviews}
          reviewsLoading={reviewsLoading}
        />
      )}
    </Sheet>
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
  // В досье пассажира показываем отзывы именно о нём как о пассажире,
  // внутри секции — первые 2.
  const allPassengerReviews = reviews.filter(
    (review) => review.targetRole === "passenger",
  );
  const passengerReviews = allPassengerReviews.slice(0, 2);
  const showReviews = reviewsLoading || allPassengerReviews.length > 0;
  // Единые template-строки: React SSR вставляет комментарии между
  // JSX-узлами, и «5 поездок» по частям не матчится (см. тесты).
  const ratingLabel =
    passenger.rating != null ? passenger.rating.toFixed(1) : "—";

  return (
    <List
      style={{
        background: "var(--tgui--secondary_bg_color)",
      }}
    >
      {/* Досье */}
      <Placeholder
        description={
          <Breadcrumbs divider="dot">
            <Breadcrumbs.Item>{`★ ${ratingLabel}`}</Breadcrumbs.Item>
            <Breadcrumbs.Item>{`${passenger.tripsCount} поездок`}</Breadcrumbs.Item>
            <Breadcrumbs.Item>{`${passenger.reviewsCount} отзывов`}</Breadcrumbs.Item>
          </Breadcrumbs>
        }
        header={<Headline weight="1">{passenger.name}</Headline>}
      >
        <Avatar
          size={96}
          src={passenger.avatar}
          acronym={passenger.name.slice(0, 2).toUpperCase()}
        >
          <Avatar.Badge large type="number">
            {ratingLabel}
          </Avatar.Badge>
        </Avatar>
      </Placeholder>

      {/* Поездка */}
      <Section
        header="Ваша поездка"
        footer={
          booking.comment
            ? `Комментарий пассажира: ${booking.comment}`
            : undefined
        }
      >
        <Banner
          before={
            <IconContainer>
              <CarFront size={28} />
            </IconContainer>
          }
          description={`${trip.date} · ${trip.time} · ${formatSeatNumber(booking.seat)} · ${trip.price} ₽`}
          header={`${trip.fromCity} → ${trip.toCity}`}
          type="section"
        />
      </Section>

      {/* Последние отзывы о пассажире — обычная секция, 2 цитаты.
          При 0 отзывов секция не рендерится. */}
      {showReviews && (
        <Section header="Последние отзывы">
          <Skeleton visible={reviewsLoading} withoutAnimation>
            {passengerReviews.map((review) => (
              <Cell
                key={review.id}
                multiline
                subtitle={<Caption weight="1">{review.tripRoute}</Caption>}
                description={
                  <Blockquote type="other">{review.text}</Blockquote>
                }
              >
                {review.date}
                <Badge type="number" large mode="secondary">
                  <Caption weight="2">
                    {review.rating != null ? review.rating.toFixed(1) : "—"}
                  </Caption>
                </Badge>
              </Cell>
            ))}
          </Skeleton>
        </Section>
      )}

      {/* Решение */}
      <Button
        size="l"
        stretched
        variant="primary"
        disabled={busy !== null}
        onClick={() => onDecide("confirmed")}
      >
        Одобрить заявку
      </Button>
      <Button
        size="l"
        stretched
        disabled={busy !== null}
        style={{ color: "var(--tgui--destructive_text_color)" }}
        onClick={() => onDecide("declined")}
      >
        Отказать
      </Button>
    </List>
  );
}
