import { useState } from "react";
import {
  Accordion,
  Avatar,
  Button,
  Caption,
  Headline,
  Modal,
  Section,
  Skeleton,
  Text,
  Placeholder,
  Cell,
  Blockquote,
  Badge,
  Breadcrumbs,
  Banner,
} from "@telegram-apps/telegram-ui";
import { X } from "lucide-react";
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
  // Счётчик в Summary — по всем (до среза), внутри — первые 2.
  const allPassengerReviews = reviews.filter(
    (review) => review.targetRole === "passenger",
  );
  const passengerReviews = allPassengerReviews.slice(0, 2);
  // Свернут по умолчанию: кнопки решения видны без скролла.
  // key по booking.id ниже сбрасывает состояние для каждой заявки.
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const showReviews =
    reviewsLoading || allPassengerReviews.length > 0;
  // Единые template-строки: React SSR вставляет комментарии между
  // JSX-узлами, и «5 поездок» по частям не матчится (см. тесты).
  const ratingLabel =
    passenger.rating != null ? passenger.rating.toFixed(1) : "—";

  return (
    <Placeholder
      action={
        <div>
          <Banner
            description={
              <Caption>
                {`${trip.date} · ${trip.time} · ${formatSeatNumber(booking.seat)} · ${trip.price} ₽`}
              </Caption>
            }
            header={<Text>{`${trip.fromCity} → ${trip.toCity}`}</Text>}
            type="section"
          >
            {booking.comment && (
              <Blockquote type="text">{booking.comment}</Blockquote>
            )}
          </Banner>

          {/* Последние отзывы о пассажире: свернуты в аккордеон,
              при 0 — секция не рендерится. Контент остаётся в DOM
              (aria-hidden), SSR-тесты видят тексты и свернутыми. */}
          {showReviews && (
            <Accordion
              key={booking.id}
              expanded={reviewsOpen}
              onChange={setReviewsOpen}
            >
              <Accordion.Summary>
                {reviewsLoading
                  ? "Отзывы"
                  : `Отзывы (${allPassengerReviews.length})`}
              </Accordion.Summary>
              <Accordion.Content>
                <Section>
                  <Skeleton visible={reviewsLoading} withoutAnimation>
                    {passengerReviews.map((review) => (
                      <Cell
                        key={review.id}
                        multiline
                        subtitle={
                          <Caption weight="1">{review.tripRoute}</Caption>
                        }
                        description={
                          <Blockquote type="other">{review.text}</Blockquote>
                        }
                      >
                        {review.date}
                        <Badge type="number" large mode="secondary">
                          <Caption weight="2">
                            {review.rating != null
                              ? review.rating.toFixed(1)
                              : "—"}
                          </Caption>
                        </Badge>
                      </Cell>
                    ))}
                  </Skeleton>
                </Section>
              </Accordion.Content>
            </Accordion>
          )}
          {/* Решение */}
          <div>
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
        </div>
      }
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
  );
}
