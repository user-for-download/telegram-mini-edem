import { IconContainer } from "@telegram-apps/telegram-ui";
import { Armchair } from "lucide-react";
import type { RideRequest } from "@edem/contracts";
import { Button } from "@/ui/Button";
import { MenuRow } from "@/ui/MenuRow";
import { useToast, type Toast } from "@/components/Toast/ToastProvider";
import { bookingErrorMessage } from "@/helpers/bookingErrors";
import type { RideRequestInvite } from "@/api/rideRequests.api";
import { useInviteRideRequestMutation } from "@/queries/useRideRequestsQuery";
import { haptic } from "@/utils/haptics";
import { plural } from "@/utils/plural";
import styles from "./TripDemandCard.module.css";

/**
 * Текст успеха различает три исхода одного и того же нажатия — иначе водитель
 * получает ложь: повторное приглашение ничего не создало, а «пропущенное»
 * уведомление (у пассажира выключены уведомления или сбой доставки) до него
 * не дошло. Оба случая бэк отдаёт как успех, поэтому различать их обязан
 * клиент — по тем же данным, что и `inviteFeedback`.
 */
export function inviteToastText(result: RideRequestInvite): string {
  if (result.duplicate) return "Приглашение уже отправлено";
  if (result.notificationId === null) {
    return "Приглашение записано, но уведомление не доставлено";
  }
  return "Приглашение отправлено";
}

/**
 * Реакция на ответ сервера — общая для всех строк, поэтому вынесена из
 * компонента: успех различает три исхода, ошибка берёт текст из общего словаря
 * кодов брони/поездок (`bookingErrorMessage`), поэтому сырое сообщение бэка
 * («Not enough available seats») в UI не попадает.
 */
function inviteFeedback(show: (toast: Toast) => void) {
  return {
    onSuccess: (result: RideRequestInvite) => {
      haptic.success();
      show({ text: inviteToastText(result) });
    },
    onError: (error: unknown) => {
      haptic.error();
      show({ text: bookingErrorMessage(error), assertive: true });
    },
  };
}

export interface TripDemandRowProps {
  request: RideRequest;
  tripId: string;
  /** Окно заявки строкой: считает карточка (общий `demandWindow`). */
  subtitle: string;
  /**
   * Мест нет — действие не рендерим. Молчащая кнопка выглядела бы поломкой,
   * а число свободных мест водитель видит на карточке своей поездки рядом.
   * Проверка на сервере (`seatsAvailable > 0`) при этом остаётся: гонка
   * «последнее место заняли минуту назад» всё равно закрывается 409.
   */
  canInvite: boolean;
  /** Тап по строке открывает поездку (отдельного экрана заявки нет). */
  onOpen: () => void;
}

/**
 * Строка спроса: `ui/MenuRow` с заявкой и её сосед — действие «Пригласить».
 *
 * Кнопка приглашения стоит РЯДОМ со строкой, а не внутри неё: `MenuRow`
 * рендерит нативный `<button>`, а кнопка в кнопке — невалидная разметка и
 * сломанный фокус (то же решение, что у действий в футере карточки поездки).
 * Обёрток с `onClick` вокруг tgui-компонентов здесь тоже нет — запрещены
 * jsx-a11y.
 *
 * Действие только для водителя по построению: карточка спроса едет рядом с его
 * поездкой и рисуется лишь там.
 *
 * Различимость соседей — требование скринридера, а не украшение: рядом стоят
 * N рядов и N кнопок «Пригласить». Имя ряда и имя кнопки различаются МЕСТАМИ
 * («2 места», «3 места»), а не окном — окно у заявок одного человека под одну
 * поездку совпадает, и тогда соседние кнопки получили бы одинаковое имя.
 */
export function TripDemandRow({
  request,
  tripId,
  subtitle,
  canInvite,
  onOpen,
}: TripDemandRowProps) {
  const toast = useToast();
  const invite = useInviteRideRequestMutation();
  const feedback = inviteFeedback(toast.show);
  // Места — в одном месте: ими подписан и ряд, и его кнопка, и различает
  // одноимённые элементы управления (у скринридера рядом N почти
  // одинаковых строк и N кнопок «Пригласить»).
  const seatsLabel = `${request.seats} ${plural(
    request.seats,
    "место",
    "места",
    "мест",
  )}`;

  // Подтверждения нет намеренно: приглашение идемпотентно (повтор по той же
  // паре заявка+поездка не создаёт второго уведомления) и ничего необратимого
  // не делает — бронь пассажир создаёт себе сам.
  const invitePassenger = () => {
    haptic.light();
    invite.mutate({ requestId: request.id, tripId }, feedback);
  };

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <MenuRow
          label={`Заявка попутчика на ${seatsLabel}`}
          title={seatsLabel}
          subtitle={subtitle}
          icon={
            <IconContainer>
              <Armchair size={18} />
            </IconContainer>
          }
          onClick={onOpen}
        />
      </div>
      {canInvite ? (
        <Button
          className={styles.invite}
          size="s"
          variant="secondary"
          // Имя БЕЗ окна, но с местами: у N строк одинаковое окно дало бы
          // N кнопок с идентичным именем, а скринридер обязан различать
          // соседние элементы управления. Места различают строки надёжнее
          // времени: окно у соседей часто совпадает (созданы одним человеком
          // под одну поездку), а места — нет.
          aria-label={`Пригласить попутчика, ${seatsLabel}`}
          // Блокируется только своя строка: мутация на ряд — своя.
          disabled={invite.isPending}
          onClick={invitePassenger}
        >
          Пригласить
        </Button>
      ) : null}
    </div>
  );
}
