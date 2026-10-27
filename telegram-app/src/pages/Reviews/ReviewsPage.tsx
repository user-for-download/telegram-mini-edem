import { memo, useMemo, useRef, useState } from "react";
import {
  Caption,
  Select,
  Text,
  Textarea,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";

import { Notice } from "@/ui/Notice";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Field } from "@/ui/Field";
import { CharCounter } from "@/ui/CharCounter";
import { FetchMore } from "@/ui/FetchMore";
import { Button } from "@/ui/Button";
import { Page } from "@/ui/Page";
import { Stack } from "@/ui/Stack";
import { Switcher } from "@/ui/Switcher";
import { Card } from "@/ui/Card";

import { haptic } from "@/utils/haptics";
import { QueryState } from "@/components/QueryState";
import { ReviewCardsSkeleton } from "@/components/Skeletons";
import { RatingInput } from "@/components/RatingInput/RatingInput";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { getSessionDraftScope } from "@/helpers/sessionDrafts";
import { captureReviewSubmission, type ReviewDraft, type ReviewInput } from "@/helpers/reviewDraftCommit";
import { ReviewCard } from "@/components/ReviewCard/ReviewCard";
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
  type ReviewField,
  type ReviewFieldError,
} from "@/pages/Reviews/reviewValidation";
import { plural } from "@/utils/plural";
import styles from "./ReviewsPage.module.css";
import { formatRating } from "@/helpers/rating";
import { listBlockingError } from "@/helpers/listBlockingError";

export type ReviewsTab = "mine" | "new" | "about";

const TABS: ReadonlyArray<{ value: ReviewsTab; label: string }> = [
  { value: "mine", label: "Мои" },
  { value: "new", label: "Новая" },
  { value: "about", label: "Обо мне" },
];

/**
 * id панели вкладки. Пункты-вкладки фасад собирает сам из `idPrefix`
 * (`reviews-tab-<value>`), поэтому `aria-labelledby` панели — та же схема.
 */
const TAB_PANEL_IDS: Record<ReviewsTab, string> = {
  mine: "reviews-panel-mine",
  new: "reviews-panel-new",
  about: "reviews-panel-about",
};

function tripLabel(trip: Trip): string {
  return `${trip.fromCity} → ${trip.toCity} · ${trip.date}`;
}

/**
 * Отзывы — самостоятельная страница `/reviews`: один экран, один список,
 * одна страница.
 *
 * Точки входа не менялись и правок не требуют: START_PARAM_ROUTES.reviews
 * (`router/deepLinks.ts`), notificationRoute для review_approved /
 * review_rejected (`NotificationsPage`) и e2e ведут на `/reviews`.
 *
 * Имя экрана — NavHeader (HEADER_TITLE_RULES, правило `/reviews`), а
 * скрытый `h1` даёт странице своё имя: NavHeader помечен `aria-hidden`
 * («авторитетные h1 живут на страницах», реестр #15).
 *
 * Вкладки: «Мои» — все мои отзывы (GET /reviews/my, статусы pending /
 * published / rejected); «Новая» — доступные поездки
 * (GET /reviews/available-trips) + форма отзыва в обе стороны (пассажир →
 * водитель, водитель → пассажиру через подтверждённые брони); «Обо мне» —
 * публичные отзывы (GET /reviews/user/:id отдаёт только published) + шапка
 * рейтинга (агрегат считает только опубликованные).
 *
 * Валидация 150 символов: maxLength на textarea (браузер) + чистая
 * validateReviewForm (показ) + createReviewDtoSchema на записи (backend
 * отклоняет > 150 тем же лимитом REVIEW_TEXT_MAX_LENGTH).
 */
export function ReviewsPage() {
  return (
    <Page>
      <VisuallyHidden Component="h1">Отзывы</VisuallyHidden>
      <ReviewsBody />
    </Page>
  );
}
/** Ключ «поездка:кто» — тем же составом, каким бэкенд считает reviewedTargets
 *  в available-trips (`reviews/index.ts`). */
export const reviewTargetKey = (tripId: string, targetUserId: string): string =>
  `${tripId}:${targetUserId}`;

/** Минимальный срез брони для отбора адресатов. */
interface ReviewableBooking {
  status: string;
  passenger: { id: string };
}

/**
 * Кого водитель ещё может оценить в этой поездке.
 *
 * Бэкенд оставляет поездку в `available-trips`, пока не оценён ХОТЯ БЫ ОДИН
 * подтверждённый пассажир, но отметку «кто уже оценён» по поездке не отдаёт.
 * Без фильтра список состоял из всех confirmed-броней, а цель по умолчанию —
 * первый элемент (заказы `createdAt desc`, то есть последний забронировавший).
 * После отзыва о P1 он оставался первым, и следующий отзыв уходил в
 * ALREADY_REVIEWED: форма вела пользователя гарантированно в ошибку.
 *
 * Чистая функция (вместо inline-фильтра), чтобы правило проверялось тестом:
 * переход состояния «отзыв отправлен → список изменился» в SSR-рендере
 * недоступен.
 */
export function selectReviewablePassengers<T extends ReviewableBooking>(
  bookings: readonly T[],
  tripId: string,
  reviewedTargets: ReadonlySet<string>,
): Array<T["passenger"]> {
  const seen = new Set<string>();
  const result: Array<T["passenger"]> = [];
  for (const booking of bookings) {
    if (booking.status !== "confirmed") continue;
    if (seen.has(booking.passenger.id)) continue;
    if (reviewedTargets.has(reviewTargetKey(tripId, booking.passenger.id))) {
      continue;
    }
    seen.add(booking.passenger.id);
    result.push(booking.passenger);
  }
  return result;
}

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

  const [form, setForm] = useSessionDraft<ReviewDraft>(
    "review:new",
    () => ({ selectedTripId: null, selectedPassengerId: null, entries: {} }),
  );
  const { selectedTripId, selectedPassengerId } = form;
  // Кого уже оценили за эту сессию: сервис такой отметки не отдаёт, а без
  // неё форма повторно предлагает только что оценённого (см.
  // selectReviewablePassengers).
  const [reviewedTargets, setReviewedTargets] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Клиентская ошибка приходит С ПОЛЕМ: <Field error=…> сам ставит
  // aria-invalid + aria-describedby и рисует текст (FieldError) рядом с тем
  // контролом, о котором сообщение. Раньше была одна строка formError, и
  // «Выберите поездку» красила кольцо вокруг комментария, а плашка без id не
  // была связана ни с одним полем — на фокусе скринридер молчал
  // (MEMORY.md §18).
  const [fieldError, setFieldError] = useState<ReviewFieldError | null>(null);
  const errorFor = (field: ReviewField) =>
    fieldError?.field === field ? fieldError.message : undefined;
  // formError остаётся для ошибок, которые не принадлежат конкретному полю:
  // ответ сервера (409 ALREADY_REVIEWED, конфликт параллельной записи).
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос.
  const submitGuard = useRef(false);

  const trips = useMemo(() => available.data ?? [], [available.data]);
  const selectedTrip: Trip | null =
    selectedTripId === null
      ? trips[0] ?? null
      : trips.find((trip) => trip.id === selectedTripId) ?? null;
  const tripUnavailable =
    selectedTripId !== null && !selectedTrip &&
    !available.isLoading && !available.isError;

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
    return selectReviewablePassengers(
      tripBookings.data?.pages.flatMap((page) => page.items) ?? [],
      selectedTrip?.id ?? "",
      reviewedTargets,
    );
  }, [isDriverTrip, tripBookings.data, reviewedTargets, selectedTrip?.id]);

  // Состояния запроса адресатов — пассажиров смотрит только водитель, поэтому
  // всё это имеет силу на своей поездке. Считать их ОТДЕЛЬНО от самого списка
  // обязательно: раньше ошибка читалась только как `data?.pages.flatMap(...)`,
  // `passengers` становился `[]`, `targetUser` — null, и «Отправить отзыв»
  // гасла навсегда, не сказав ни слова (MEMORY.md §18 — сетевая ошибка не
  // ошибка валидации).
  const targetsPending = isDriverTrip && tripBookings.isLoading;
  const targetsFailed = isDriverTrip && tripBookings.isError;
  // Пустота по-настоящему: сервер ответил и подтверждённых пассажиров не
  // осталось. Пока грузится или упало — утверждать «пассажиров нет» нельзя
  // (MEMORY.md §18: неизвестное число не ноль).
  const targetsEmpty =
    isDriverTrip &&
    !targetsPending &&
    !targetsFailed &&
    passengers.length === 0;

  // Цель отзыва: пассажир всегда пишет водителю; водитель выбирает
  // пассажира (явный выбор > первый в списке).
  const targetUser: User | null = isDriverTrip
    ? selectedPassengerId === null
      ? passengers[0] ?? null
      : passengers.find((p) => p.id === selectedPassengerId) ?? null
    : (selectedTrip?.driver ?? null);
  const passengerUnavailable =
    isDriverTrip && selectedPassengerId !== null && !targetUser &&
    !targetsPending && !targetsFailed;
  const targetKey =
    selectedTrip && targetUser
      ? reviewTargetKey(selectedTrip.id, targetUser.id)
      : null;
  const { rating, text } = (targetKey ? form.entries[targetKey] : undefined) ?? {
    rating: 5,
    text: "",
  };
  useClosingConfirmation(
    selectedTripId !== null ||
      selectedPassengerId !== null ||
      Object.values(form.entries).some(
        (entry) => entry.text !== "" || entry.rating !== 5,
      ),
  );
  const updateInput = (input: Partial<ReviewInput>) => {
    if (!selectedTrip || !targetUser || !targetKey) return;
    setForm((current) => ({
      ...current,
      selectedTripId: selectedTrip.id,
      selectedPassengerId: isDriverTrip ? targetUser.id : null,
      entries: {
        ...current.entries,
        [targetKey]: {
          ...(current.entries[targetKey] ?? { rating: 5, text: "" }),
          ...input,
        },
      },
    }));
  };

  // Подпись формы. Предлог «о» требует падежа, а имя мы не склоняем:
  // «Отзыв о Марина Ковалёва» ломало согласование (реестр #59). Роль стоит
  // в нужной форме сама, имя — в постпозиции после двоеточия; без
  // выбранной цели строка остаётся прежним «Отзыв о водителе».
  const aboutLine = `Отзыв о ${isDriverTrip ? "пассажире" : "водителе"}${
    targetUser ? `: ${targetUser.name}` : ""
  }`;

  const aboutItems = useMemo(
    () => about.data?.pages.flatMap((page) => page.items) ?? [],
    [about.data],
  );

  // Selection only: text/rating are restored from the separate trip/recipient entry.
  const resetTarget = (tripId: string | null, passengerId: string | null) => {
    setForm((current) => ({
      ...current,
      selectedTripId: tripId ?? selectedTrip?.id ?? null,
      selectedPassengerId: passengerId,
    }));
    // Ошибки относятся к прежнему адресату; новый ввод проверяется при отправке.
    setFieldError(null);
    setFormError(null);
    setSuccess(false);
  };

  const pickTrip = (tripId: string) => {
    resetTarget(tripId, null);
  };

  const submit = () => {
    if (
      create.isPending || submitGuard.current || available.isLoading ||
      available.isError || targetsPending || targetsFailed
    ) return;

    // Ошибка формы всегда идёт С ПОЛЕМ: без этого textarea получал
    // aria-invalid при ошибке про поездку, а у обоих Select не появлялось
    // ни aria-invalid, ни aria-describedby (MEMORY.md §18).
    if (!selectedTrip) {
      setFieldError({ field: "trip", message: "Выберите поездку" });
      return;
    }
    if (!targetUser) {
      setFieldError({
        field: "target",
        message: "Не найден пользователь для отзыва",
      });
      return;
    }
    const validationError = validateReviewForm(text);
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    setFieldError(null);
    setSuccess(false);
    submitGuard.current = true;
    const submittedKey = reviewTargetKey(selectedTrip.id, targetUser.id);
    const onCommitted = captureReviewSubmission(
      getSessionDraftScope(me?.id ?? null),
      "review:new",
      submittedKey,
      form.entries[submittedKey]!,
    );
    create.mutate(
      {
        tripId: selectedTrip.id,
        targetUserId: targetUser.id,
        rating,
        text: normalizeReviewText(text),
        onCommitted,
      },
      {
        onSettled: () => {
          submitGuard.current = false;
        },
        onSuccess: () => {
          if (!onCommitted()) return;
          haptic.success();
          // Запоминаем «поездка:кто», чтобы пассажир не вернулся в список
          // выбора и следующий отзыв не ушёл в тот же 409.
          setReviewedTargets((current) => {
            const next = new Set(current);
            next.add(reviewTargetKey(selectedTrip.id, targetUser.id));
            return next;
          });
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
    !available.isLoading &&
    !available.isError &&
    !targetsPending &&
    !targetsFailed &&
    !create.isPending;

  const pickTab = (next: ReviewsTab) => setTab(next);

  return (
    <Stack>
      <Switcher
        options={TABS}
        value={tab}
        onChange={pickTab}
        ariaLabel="Разделы отзывов"
        idPrefix="reviews-tab"
        semantics="tabs"
        panelId={TAB_PANEL_IDS[tab]}
      />

      <div
        role="tabpanel"
        id={TAB_PANEL_IDS[tab]}
        aria-labelledby={`reviews-tab-${tab}`}
      >
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
              <EmptyState
                header={EMPTY_STATES.reviewsMineEmpty.header}
                description={EMPTY_STATES.reviewsMineEmpty.description}
                action={
                  <Button
                    size="m"
                    variant="primary"
                    onClick={() => pickTab("new")}
                  >
                    Оставить отзыв
                  </Button>
                }
              />
            ) : (
              <Stack>
                {my.data.map((review) => (
                  <ReviewCard key={review.id} review={review} />
                ))}
              </Stack>
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
            {trips.length === 0 ? (
              <EmptyState
                header={EMPTY_STATES.reviewsNewEmpty.header}
                description={EMPTY_STATES.reviewsNewEmpty.description}
              />
            ) : (
              <Card className={styles.card}>
                <Field
                  label="Поездка"
                  id="review-trip"
                  error={
                    tripUnavailable
                      ? "Выбранная поездка больше недоступна — выберите другую"
                      : errorFor("trip")
                  }
                >
                  {(field) => (
                    <Select
                      {...field}
                      value={selectedTrip?.id ?? ""}
                      onChange={(event) => pickTrip(event.target.value)}
                    >
                      {!selectedTrip && (
                        <option value="">Выберите поездку</option>
                      )}
                      {trips.map((trip) => (
                        <option key={trip.id} value={trip.id}>
                          {tripLabel(trip)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                {isDriverTrip ? (
                  <>
                    {targetsFailed && (
                      <>
                        <Notice tone="danger" variant="text">
                          Не удалось загрузить список пассажиров поездки
                        </Notice>
                        {/* Повтор точечный (не через QueryState): поездки
                            приехали, сломался один запрос — адресаты. */}
                        <Button
                          variant="ghost"
                          size="m"
                          onClick={() => void tripBookings.refetch()}
                        >
                          Повторить
                        </Button>
                      </>
                    )}
                    <Field
                      label="Кому оставить отзыв"
                      id="review-target"
                      error={
                        passengerUnavailable
                          ? "Выбранный пассажир больше недоступен — выберите другого"
                          : errorFor("target")
                      }
                    >
                      {(field) => (
                        <Select
                          {...field}
                          value={targetUser?.id ?? ""}
                          disabled={
                            targetsPending || targetsFailed || targetsEmpty
                          }
                          onChange={(event) => {
                            resetTarget(null, event.target.value);
                          }}
                        >
                          {targetsPending && (
                            <option value="">Загрузка…</option>
                          )}
                          {targetsFailed && (
                            <option value="">Список недоступен</option>
                          )}
                          {targetsEmpty && (
                            <option value="">Нет пассажиров</option>
                          )}
                          {passengerUnavailable && !targetsEmpty && (
                            <option value="">Выберите пассажира</option>
                          )}
                          {passengers.map((passenger) => (
                            <option key={passenger.id} value={passenger.id}>
                              {passenger.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {targetsEmpty && (
                      <Notice tone="info" variant="text">
                        Не найден пользователь для отзыва: по этой поездке не
                        осталось неоценённых пассажиров.
                      </Notice>
                    )}
                  </>
                ) : (
                  <Text weight="2" Component="p">
                    {aboutLine}
                  </Text>
                )}

                <div>
                  <span id="review-rating-label">Оценка</span>
                  <RatingInput
                    value={rating}
                    onChange={(rating) => updateInput({ rating })}
                  />
                </div>

                <Field
                  label="Комментарий"
                  id="review-text"
                  error={errorFor("text")}
                >
                  {(field) => (
                    <Textarea
                      {...field}
                      rows={3}
                      maxLength={REVIEW_TEXT_MAX_LENGTH}
                      placeholder="Расскажите, что понравилось или что стоит улучшить"
                      value={text}
                      onChange={(event) => {
                        updateInput({ text: event.target.value });
                        if (fieldError) setFieldError(null);
                        if (success) setSuccess(false);
                      }}
                    />
                  )}
                </Field>
                {text.length > 0 && (
                  <CharCounter
                    value={text.length}
                    max={REVIEW_TEXT_MAX_LENGTH}
                  />
                )}

                {/* Ошибка СЕРВЕРА (409 и пр.) — не привязана к полю: её показываем
                    общей плашкой, в отличие от клиентских ошибок формы,
                    которые уехали в errorFor(...) на конкретный контрол. */}
                {formError && (
                  <Notice tone="danger" variant="text">
                    {formError}
                  </Notice>
                )}
                {success && (
                  <Notice tone="success" variant="text">
                    Отзыв отправлен на модерацию — он появится в профиле после
                    одобрения
                  </Notice>
                )}
                {/* Кнопка не рендерится, когда адресаты не загрузились: она бы
                    осталась выключенной навсегда и выглядела бы так, будто
                    заполнять форму нечем (MEMORY.md §18). Терминальное
                    состояние с «Повторить» — выше, рядом с выбором. В остальных
                    случаях каждая причина блокировки — клиентская, и рядом с
                    кнопкой написано, чего именно не хватает. */}
                {!targetsFailed && (
                  <Button
                    stretched
                    size="l"
                    variant="primary"
                    loading={create.isPending}
                    disabled={!canSubmit}
                    onClick={submit}
                  >
                    Отправить отзыв
                  </Button>
                )}
                {/* Причина блокировки названа рядом с кнопкой: пустой
                    комментарий — единственная оставшаяся клиентская причина,
                    и текст тот же, что отдаёт validateReviewForm. */}
                {!targetsFailed &&
                  !create.isPending &&
                  text.trim().length === 0 && (
                    <Caption Component="p">
                      Добавьте комментарий к отзыву
                    </Caption>
                  )}
              </Card>
            )}
          </QueryState>
        )}

        {tab === "about" && (
          <QueryState
            loading={profile.isLoading || about.isLoading}
            error={profile.error ?? listBlockingError(about)}
            empty={false}
            emptyText=""
            skeleton={<ReviewCardsSkeleton />}
            onRetry={() => {
              void profile.refetch();
              void about.refetch();
            }}
          >
            {profile.data && (
              <Card className={styles.emptyCard}>
                <Text weight="2" Component="p">
                  {`Рейтинг ${formatRating(profile.data.rating, profile.data.reviewsCount)} · ${profile.data.reviewsCount} ${plural(profile.data.reviewsCount, "отзыв", "отзыва", "отзывов")}`}
                </Text>
                <Caption Component="p" className={styles.emptyNote}>
                  Рейтинг учитывает только опубликованные отзывы
                </Caption>
              </Card>
            )}
            {aboutItems.length === 0 ? (
              <EmptyState
                header={EMPTY_STATES.reviewsAboutEmpty.header}
                description={EMPTY_STATES.reviewsAboutEmpty.description}
              />
            ) : (
              <Stack>
                {aboutItems.map((review) => (
                  <ReviewCard key={review.id} review={review} />
                ))}
                <FetchMore
                  hasNextPage={about.hasNextPage}
                  isFetchingNextPage={about.isFetchingNextPage}
                  fetchNextPage={() => void about.fetchNextPage()}
                  error={about.isFetchNextPageError ? about.error : null}
                />
              </Stack>
            )}
          </QueryState>
        )}
      </div>
    </Stack>
  );
});
