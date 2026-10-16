import { Caption, Text } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { useToast } from "@/components/Toast/ToastProvider";
import { MIN_TARGET } from "@/ui/classes";
import { EditTripForm } from "@/components/Trip/EditTripForm";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import { useTripBookingsQuery } from "@/queries/useBookingsQuery";
import {
  useCancelTripMutation,
  useCompleteTripMutation,
} from "@/queries/useTripsQuery";
import { useNavigate } from "react-router-dom";
import styles from "./TripDetailsPage.module.css";

interface DriverPanelProps {
  tripId: string;
  status: string | undefined;
  isActive: boolean;
  canCompleteTrip: boolean;
  /** Отправление уже прошло. Отменять такую поездку нельзя (бэкенд 409). */
  departed: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  trip: Parameters<typeof EditTripForm>[0]["trip"];
}

/**
 * Управление поездкой водителя: заявки, редактирование, завершение,
 * отмена. Заявки запрашиваются только здесь — остальным бэкенд вернёт 403.
 */
export function DriverPanel({
  tripId,
  status,
  isActive,
  canCompleteTrip,
  departed,
  editing,
  onToggleEdit,
  trip,
}: DriverPanelProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const cancelTrip = useCancelTripMutation();
  const completeTrip = useCompleteTripMutation();
  // Исход завершения/отмены водителю объявляем ВСЛУХ: без этого кнопки просто
  // исчезают из DOM (после инвалидации trip перестаёт быть активным), и ни
  // скринридер, ни клавиатурный пользователь не узнают, что действие прошло.
  //
  // Механизм — тот же, что у бронирования (useTripActions.ts) и у отмены на
  // главной (TripActivePage.tsx): toast.show → Snackbar с role="status" и
  // aria-live="polite". Роль ставит сам ToastProvider на узел с ТЕКСТОМ, а не
  // на обёртку — портал иначе оставил бы её на пустом узле (MEMORY.md:485).
  //
  // Это подтверждение успеха, поэтому toast НЕ assertive: role="alert" здесь
  // был бы враньём. Неудача объявляется отдельно и громче — Notice
  // tone="danger" ниже, у него role="alert" по умолчанию.
  //
  // onSuccess передан В МУТАЦИЮ, а не в хук: семантика useCompleteTripMutation
  // (инвалидация trips + доступных для отзыва поездок) не меняется — TanStack
  // выполняет хуковый и поточечный обработчики оба.
  const complete = () =>
    completeTrip.mutate(tripId, {
      onSuccess: () =>
        toast.show({
          text: "Поездка завершена",
          description: "Пассажиры могут оставить отзыв",
        }),
    });
  // Формулировка та же, что на главной (TripActivePage) и в пуш-уведомлении
  // бэкенда: одно и то же действие не должно называться по-разному.
  const cancel = () =>
    cancelTrip.mutate(tripId, {
      onSuccess: () => toast.show({ text: "Поездка отменена" }),
    });
  // Заявки видны только водителю: остальным бэкенд вернёт 403,
  // поэтому запрос делаем только здесь.
  const bookings = useTripBookingsQuery(tripId, { enabled: isActive });
  // Число в кнопке — СЕРВЕРНЫЙ pendingRequestsCount из trip (детали уже
  // загружены, нового запроса не нужно). Считать по загруженным
  // страницам нельзя: /bookings/trip/:id отдаёт по 50 строк на страницу,
  // и при >50 заявках водитель видел бы «50» вместо реального числа
  // (пагинация при этом не подгружается — кнопка ведёт на экран заявок).
  // Строки по 50 для отрисовки списка на экране заявок остаются: там нужен
  // сам список, а не его длина.
  //
  // pendingRequestsCount опционален в контракте — при его отсутствии
  // откатываемся к подсчёту по загруженным страницам.
  const loadedPendingCount =
    bookings.data?.pages
      .flatMap((page) => page.items)
      .filter((booking) => booking.status === "pending").length ?? 0;
  const pendingCount = trip.pendingRequestsCount ?? loadedPendingCount;

  return (
    <div className={styles.section}>
      <Text weight="2" Component="div">
        Управление поездкой
      </Text>
      {/* role="status" — НА САМОМ узле с текстом (MEMORY.md:485), не на
          обёртке: строка появляется в DOM уже с готовым текстом и остаётся
          после того, как тост (3,2 с) скроется, то есть это и есть постоянная
          запись исхода, а тост — мгновенное объявление. Образец: TripHero.tsx
          (shareStatus). */}
      {status === "completed" && (
        <Caption Component="p" role="status">
          Поездка завершена — пассажиры могут оставить отзыв.
        </Caption>
      )}
      {status === "cancelled" && (
        <Caption Component="p" role="status">
          Поездка отменена — недоступна для бронирования.
        </Caption>
      )}
      {isActive && (
        <>
          <Button
            stretched
            onClick={() => navigate(`/trips/my/${tripId}/requests`)}
          >
            Заявки пассажиров{bookings.data ? ` (${pendingCount})` : ""}
          </Button>
          {bookings.isError && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(bookings.error)}{" "}
              <Button
                variant="ghost"
                size="s"
                onClick={() => void bookings.refetch()}
              >
                Повторить
              </Button>
            </Notice>
          )}
          <Button stretched onClick={onToggleEdit}>
            {editing ? "Скрыть редактирование" : "Редактировать поездку"}
          </Button>
          {editing && <EditTripForm trip={trip} onDone={onToggleEdit} />}
          <ConfirmPopup
            label="Завершить поездку"
            confirmLabel="Завершить"
            description="Поездка будет перенесена в архив, а пассажиры смогут оставить отзывы."
            pending={completeTrip.isPending}
            disabled={
              !canCompleteTrip || completeTrip.isPending || cancelTrip.isPending
            }
            className={MIN_TARGET}
            onConfirm={complete}
          />
          {!canCompleteTrip && (
            <p className={styles.hintXs}>
              Завершение станет доступно после времени отправления.
            </p>
          )}
          {!departed && (
            <ConfirmPopup
              label="Отменить поездку"
              confirmLabel="Отменить поездку"
              description="Поездка станет недоступна, а пассажиры получат уведомление об отмене."
              pending={cancelTrip.isPending}
              // Отменяем мысленно нажатой «Завершить» — действие на ту же
              // поездку, оно не должно проходить, пока PATCH в полёте.
              disabled={cancelTrip.isPending || completeTrip.isPending}
              destructive
              className={MIN_TARGET}
              onConfirm={cancel}
            />
          )}
          {departed && (
            <p className={styles.hintXs}>
              Отмена недоступна после отправления — поездку можно завершить.
            </p>
          )}
          {(cancelTrip.error || completeTrip.error) && (
            <Notice tone="danger" variant="text">
              {bookingErrorMessage(cancelTrip.error ?? completeTrip.error)}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
