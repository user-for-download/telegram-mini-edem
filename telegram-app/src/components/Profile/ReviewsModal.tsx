import { memo, useMemo, useRef, useState } from "react";
import {
  Button,
  Caption,
  Modal,
  Placeholder,
  SegmentedControl,
  Select,
  Text,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { useNavigate } from "react-router-dom";
import { QueryState } from "@/components/QueryState";
import { ReviewCardsSkeleton } from "@/components/Skeletons";
import { haptic } from "@/utils/haptics";
import { RatingInput } from "@/components/RatingInput/RatingInput";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { ReviewCard } from "@/components/ReviewCard/ReviewCard";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import { ApiError } from "@/api/client";
import { REVIEW_TEXT_MAX_LENGTH, type Trip, type User } from "@edem/contracts";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileQuery } from "@/queries/profile";
import {
  useAvailableReviewTripsQuery,
  useCreateReviewMutation,
  useMyReviewsQuery,
  useUserReviewsInfiniteQuery,
} from "@/queries/useReviewsQuery";
import { useTripBookingsQuery } from "@/queries/useBookingsQuery";
import {
  normalizeReviewText,
  validateReviewForm,
} from "@/pages/Reviews/reviewValidation";
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import styles from "./ProfileModals.module.css";

export type ReviewsTab = "mine" | "new" | "about";

const TABS: ReadonlyArray<{ value: ReviewsTab; label: string }> = [
  { value: "mine", label: "Мои" },
  { value: "new", label: "Новая" },
  { value: "about", label: "Обо мне" },
];

function tripLabel(trip: Trip): string {
  return `${trip.fromCity} → ${trip.toCity} · ${trip.date}`;
}

/**
 * Отзывы и рейтинг — route-backed шторка поверх «Профиля»; роут
 * /reviews остаётся источником правды ради диплинков START_PARAM_ROUTES,
 * точек входа ProfilePage и нотификаций review_approved/review_rejected).
 *
 * Закрытие: native Back — через Shell.handleBack (стек handleModalBack
 * пуст для route-модалок → navigate(-1)), прямой вход — fallback на
 * /profile. PageHeader с back-кнопкой внутри убран — закрытие через
 * header шторки. a11y: нативный telegram-ui Modal (vaul Drawer поверх
 * Radix Dialog) даёт role=dialog + aria-modal, Esc/overlay-закрытие через
 * onOpenChange, focus-trap и возврат фокуса; таргеты ≥44px (звёзды
 * RatingInput — 44px в своём module.css, кнопки — minHeight 44).
 */
export function ReviewsModal({
  open,
  onClose,
  initialTab = "mine",
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: ReviewsTab;
}) {
  // Фокус, Esc и Tab-trap — нативные (Radix FocusScope + onOpenChange);
  // свой role=dialog не добавляем — vaul уже рендерит dialog (двойной анонс).
  // Имя диалога + видимый заголовок на base: tgui Modal.Header рисует
  // текст только на iOS.
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Отзывы</Modal.Header>}
      aria-labelledby={titleId}
    >
      <div className={styles.sheetBodyEdge}>
        <SheetTitle titleId={titleId}>Отзывы</SheetTitle>
        <ReviewsBody initialTab={initialTab} />
      </div>
    </Modal>
  );
}

/**
 * Роут /reviews: фон — «Профиль» (точка входа ProfilePage:409),
 * поверх — шторка отзывов. Закрытие — назад по истории, иначе
 * fallback на /profile. Путь, START_PARAM_ROUTES и notificationRoute
 * (review_approved/review_rejected → /reviews) не меняются.
 */
export function ReviewsRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  };
  return (
    <>
      <ProfilePage />
      <ReviewsModal open onClose={close} />
    </>
  );
}

/**
 * Тело отзывов (экспортировано для SSR-тестов: Modal — портал, в
 * renderToString не попадает). Мемоизировано (тяжёлые списки отзывов).
 * Без PageHeader — закрытие через header модалки.
 *
 * Вкладки отзывов:
 * - «Мои» — все мои отзывы (GET /reviews/my, все статусы: pending /
 *   published / rejected с подписями);
 * - «Новая» — доступные поездки (GET /reviews/available-trips) + форма
 *   создания отзыва в обе стороны (пассажир → водителю, водитель →
 *   пассажиру через подтверждённые брони);
 * - «Обо мне» — публичные отзывы (GET /reviews/user/:id отдаёт только
 *   published) + шапка рейтинга (агрегат считает только опубликованные).
 *
 * Валидация 150 символов: maxLength на textarea (браузер) + чистая
 * validateReviewForm (показ) + createReviewDtoSchema на записи (backend
 * отклоняет > 150 тем же лимитом REVIEW_TEXT_MAX_LENGTH).
 */
export const ReviewsBody = memo(function ReviewsBody({
  initialTab = "mine",
}: {
  initialTab?: ReviewsTab;
}) {
  const [tab, setTab] = useState<ReviewsTab>(initialTab);
  const me = useAuthStore((state) => state.user);

  const my = useMyReviewsQuery();
  const available = useAvailableReviewTripsQuery();
  const profile = useProfileQuery();
  const about = useUserReviewsInfiniteQuery(me?.id ?? "", 20);
  const create = useCreateReviewMutation();

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedPassengerId, setSelectedPassengerId] = useState<string | null>(
    null,
  );
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  useClosingConfirmation(
    text !== "" ||
      selectedTripId !== null ||
      selectedPassengerId !== null ||
      rating !== 5,
  );
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос (защита от двойного сабмита).
  const submitGuard = useRef(false);

  const trips = useMemo(() => available.data ?? [], [available.data]);
  const selectedTrip: Trip | null =
    trips.find((trip) => trip.id === selectedTripId) ?? trips[0] ?? null;

  const isDriverTrip = Boolean(
    me && selectedTrip && selectedTrip.driver.id === me.id,
  );

  // Водитель отзывается о пассажирах: цели — подтверждённые брони поездки
  // (useTripBookingsQuery — infinite, сплющиваем страницы).
  const tripBookings = useTripBookingsQuery(selectedTrip?.id ?? "", {
    enabled: Boolean(selectedTrip) && isDriverTrip,
  });
  const passengers: User[] = useMemo(() => {
    if (!isDriverTrip) return [];
    const seen = new Map<string, User>();
    for (const page of tripBookings.data?.pages ?? []) {
      for (const booking of page.items) {
        if (booking.status === "confirmed" && !seen.has(booking.passenger.id)) {
          seen.set(booking.passenger.id, booking.passenger);
        }
      }
    }
    return [...seen.values()];
  }, [isDriverTrip, tripBookings.data]);

  // Цель отзыва: пассажир всегда пишет водителю; водитель выбирает
  // пассажира (явный выбор > первый в списке).
  const targetUser: User | null = isDriverTrip
    ? (passengers.find((p) => p.id === selectedPassengerId) ??
      passengers[0] ??
      null)
    : (selectedTrip?.driver ?? null);

  const aboutItems = useMemo(
    () => about.data?.pages.flatMap((page) => page.items) ?? [],
    [about.data],
  );

  const pickTrip = (tripId: string) => {
    setSelectedTripId(tripId);
    setSelectedPassengerId(null);
    setFormError(null);
    setSuccess(false);
  };

  const submit = () => {
    if (create.isPending || submitGuard.current) return;

    if (!selectedTrip) {
      setFormError("Выберите поездку");
      return;
    }
    if (!targetUser) {
      setFormError("Не найден пользователь для отзыва");
      return;
    }
    const validationError = validateReviewForm(text);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);
    setSuccess(false);
    submitGuard.current = true;
    create.mutate(
      {
        tripId: selectedTrip.id,
        targetUserId: targetUser.id,
        rating,
        text: normalizeReviewText(text),
      },
      {
        onSettled: () => {
          submitGuard.current = false;
        },
        onSuccess: () => {
          haptic.success();
          setText("");
          setRating(5);
          setSuccess(true);
        },
        onError: (error) => {
          haptic.error();
          if (error instanceof ApiError && error.code === "ALREADY_REVIEWED") {
            setFormError(
              "Вы уже оставили отзыв об этом пользователе в этой поездке",
            );
          } else if (error instanceof ApiError && error.code === "CONFLICT") {
            setFormError("Конфликт параллельной записи — повторите попытку");
          } else {
            setFormError(
              error instanceof Error
                ? error.message
                : "Не удалось отправить отзыв",
            );
          }
        },
      },
    );
  };

  const canSubmit =
    Boolean(selectedTrip) &&
    Boolean(targetUser) &&
    text.trim().length > 0 &&
    !create.isPending;

  const pickTab = (next: ReviewsTab) => {
    if (next !== tab) {
      hapticFeedback.selectionChanged.ifAvailable();
      setTab(next);
    }
  };

  return (
    <div className={styles.stackPadded}>
      <div role="tablist" aria-label="Разделы отзывов">
        <SegmentedControl>
          {TABS.map((option) => (
            <SegmentedControl.Item
              key={option.value}
              selected={tab === option.value}
              aria-selected={tab === option.value}
              onClick={() => pickTab(option.value)}
            >
              {option.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>

      {tab === "mine" && (
        <QueryState
          loading={my.isLoading}
          error={my.error}
          empty={false}
          emptyText=""
          skeleton={<ReviewCardsSkeleton />}
          onRetry={() => void my.refetch()}
        >
          {!my.data || my.data.length === 0 ? (
            <Placeholder
              header="Вы пока не оставили отзывов"
              description="Оставьте отзыв о поездке — это поможет другим выбрать маршрут"
            >
              <Button
                size="m"
                mode="bezeled"
                style={{ minHeight: 44 }}
                onClick={() => pickTab("new")}
              >
                Оставить отзыв
              </Button>
            </Placeholder>
          ) : (
            <div className={styles.list}>
              {my.data.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </QueryState>
      )}

      {tab === "new" && (
        <QueryState
          loading={available.isLoading}
          error={available.error}
          empty={false}
          emptyText=""
          onRetry={() => void available.refetch()}
        >
          {trips.length === 0 || !selectedTrip ? (
            <Placeholder
              header="Пока нет поездок для отзыва"
              description="Когда вы совершите поездку, она появится здесь"
            />
          ) : (
            <div className={styles.card}>
              <div>
                <label htmlFor="review-trip" className="sr-only">
                  Поездка
                </label>
                <Select
                  id="review-trip"
                  header="Поездка"
                  value={selectedTrip.id}
                  onChange={(event) => pickTrip(event.target.value)}
                >
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {tripLabel(trip)}
                    </option>
                  ))}
                </Select>
              </div>

              {isDriverTrip ? (
                <div>
                  <label htmlFor="review-target" className="sr-only">
                    Кому оставить отзыв
                  </label>
                  <Select
                    id="review-target"
                    header="Кому оставить отзыв"
                    value={targetUser?.id ?? ""}
                    onChange={(event) => {
                      setSelectedPassengerId(event.target.value);
                      if (formError) setFormError(null);
                    }}
                  >
                    {passengers.map((passenger) => (
                      <option key={passenger.id} value={passenger.id}>
                        {passenger.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <Text weight="2" Component="p">
                  Отзыв о {targetUser?.name ?? "водителе"}
                </Text>
              )}

              <div>
                <span id="review-rating-label">Оценка</span>
                <RatingInput value={rating} onChange={setRating} />
              </div>

              <div>
                <label htmlFor="review-text" className="sr-only">
                  Комментарий
                </label>
                <Textarea
                  id="review-text"
                  header="Комментарий"
                  rows={3}
                  maxLength={REVIEW_TEXT_MAX_LENGTH}
                  placeholder="Расскажите, что понравилось или что стоит улучшить"
                  value={text}
                  aria-invalid={Boolean(formError)}
                  status={formError ? "error" : undefined}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (formError) setFormError(null);
                    if (success) setSuccess(false);
                  }}
                />
              </div>
              {text.length > 0 && (
                <Caption
                  Component="p"
                  className={styles.counter}
                  aria-live="polite"
                >
                  {text.length}/{REVIEW_TEXT_MAX_LENGTH}
                </Caption>
              )}

              {formError && (
                <Caption
                  Component="p"
                  role="alert"
                  className={styles.errorText}
                >
                  {formError}
                </Caption>
              )}
              {success && (
                <Text
                  Component="p"
                  role="status"
                  className={styles.successText}
                >
                  Отзыв отправлен на модерацию — он появится в профиле после
                  одобрения
                </Text>
              )}
              <Button
                mode="bezeled"
                stretched
                size="l"
                loading={create.isPending}
                disabled={!canSubmit}
                onClick={submit}
              >
                Отправить отзыв
              </Button>
            </div>
          )}
        </QueryState>
      )}

      {tab === "about" && (
        <QueryState
          loading={profile.isLoading || about.isLoading}
          error={profile.error ?? about.error}
          empty={false}
          emptyText=""
          skeleton={<ReviewCardsSkeleton />}
          onRetry={() => {
            void profile.refetch();
            void about.refetch();
          }}
        >
          {profile.data && (
            <div className={styles.emptyCard}>
              <Text weight="2" Component="p">
                {`Рейтинг ${profile.data.rating.toFixed(1)} · ${profile.data.reviewsCount} отзывов`}
              </Text>
              <Caption Component="p" className={styles.emptyNote}>
                Рейтинг учитывает только опубликованные отзывы
              </Caption>
            </div>
          )}
          {aboutItems.length === 0 ? (
            <Placeholder
              header="О вас пока нет отзывов"
              description="После поездок пассажиры и водители смогут оценить вас — отзывы появятся здесь"
            />
          ) : (
            <div className={styles.list}>
              {aboutItems.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
              {about.hasNextPage && (
                <Button
                  mode="bezeled"
                  stretched
                  style={{ minHeight: 44 }}
                  loading={about.isFetchingNextPage}
                  disabled={about.isFetchingNextPage}
                  onClick={() => void about.fetchNextPage()}
                >
                  Показать ещё
                </Button>
              )}
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
});
