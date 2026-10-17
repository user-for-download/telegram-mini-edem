import { Caption } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { useToast } from "@/components/Toast/ToastProvider";
import { MIN_TARGET } from "@/ui/classes";
import { EditTripForm } from "@/components/Trip/EditTripForm";
import { TripPassengers } from "@/components/Trip/TripPassengers";
import { GroupLabel } from "@/ui/GroupLabel";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import {
  useCancelTripMutation,
  useCompleteTripMutation,
} from "@/queries/useTripsQuery";
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
  return (
    <>
      {/* Заявки и подтверждённые пассажиры — ПРЯМО ЗДЕСЬ, а не второй
          шторкой поверх деталей: «Заявки пассажиров» открывали ещё одну
          route-backed модалку, и водитель закрывал две подряд. Те же
          Cell'ы, что в карточке поездки (TripPassengers → DriverTripRequests).
          Секция целиком скрыта у неактивной поездки: список над пустотой
          читался как незагрузившийся.
          Отдельного заголовка «Пассажиры» нет — группы подписаны сами
          («Ожидают решения (N)» / «В поездке (N)»), третий уровень над
          ними был бы лишним. */}
      {isActive && (
        <div className={styles.section}>
          <TripPassengers
            tripId={tripId}
            pendingCount={trip.pendingRequestsCount}
          />
        </div>
      )}

      <div className={styles.section}>
      {/* Надпись над группой действий, а не второй заголовок экрана:
          раньше это был Text 17/600, и он спорил с названием поездки. */}
      <GroupLabel Component="div">Управление поездкой</GroupLabel>
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
          <Button stretched variant="outline" onClick={onToggleEdit}>
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
            // outline: завершение — не главное действие экрана (главное —
            // заявки), и две одинаковые залитые плашки рядом читались как
            // равнозначные.
            mode="outline"
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
              // plain: деструктивное действие — тише остальных, но
              // по-прежнему красным. Раньше это была ещё одна залитая
              // плашка 44px, и четыре равных по весу кнопки подряд не
              // давали понять, какая из них основная.
              mode="plain"
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
    </>
  );
}
