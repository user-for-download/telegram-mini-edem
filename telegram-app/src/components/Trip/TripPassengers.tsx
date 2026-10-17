import { Avatar, Caption, Subheadline } from "@telegram-apps/telegram-ui";
import { Cell } from "@/ui/Cell";
import { STATIC_CELL } from "@/ui/classes";
import { DriverTripRequests } from "@/components/Trip/DriverTripRequests";
import { useTripBookingsQuery } from "@/queries/useBookingsQuery";
import styles from "./TripCards.module.css";

/**
 * Пассажиры поездки в шторке деталей — вместо второй шторки.
 *
 * Раньше «Заявки пассажиров» открывались отдельной route-backed шторкой
 * ПОВЕРХ деталей: две модалки друг на друге, закрытие — два раза подряд,
 * а accept/decline жили в третьем месте. Теперь те же Cell'ы, что в
 * карточке поездки (общий `DriverTripRequests`: аватар, рейтинг, место,
 * комментарий, ✕/✓ по 44px), показываются прямо в деталях.
 *
 * Подтверждённые пассажиры — только чтение: решение по ним уже принято,
 * действия (отмена брони) остаются у самой брони, а не у водителя.
 */
export function TripPassengers({
  tripId,
  pendingCount,
}: {
  tripId: string;
  /**
   * Серверный `pendingRequestsCount` из detailing-ответа. Строки заявок
   * приходят постранично (50 на страницу), поэтому подпись группы берёт
   * точное число у сервера, а не считает загруженные строки.
   */
  pendingCount?: number;
}) {
  // Список рендерится только у активной поездки (см. DriverPanel): у
  // завершённой/отменённой бэкенд отдал бы 403 на заявки.
  const query = useTripBookingsQuery(tripId);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const confirmed = items.filter((booking) => booking.status === "confirmed");
  const pending = pendingCount ?? items.filter((b) => b.status === "pending").length;

  // Пока данные не пришли, «Заявок пока нет» было бы враньём: скелетон
  // заявок рисует сам DriverTripRequests.
  const empty = !query.isLoading && !query.isError && pending === 0 && confirmed.length === 0;

  return (
    <div className={styles.passengers}>
      {query.isError && (
        <Caption Component="p" className={styles.passengersHint}>
          Не удалось загрузить заявки.
        </Caption>
      )}

      {pending > 0 && (
        <Caption weight="2" Component="p" className={styles.passengersGroup}>
          {`Ожидают решения (${pending})`}
        </Caption>
      )}

      {/* Ожидающие решения — ровно те же строки, что в карточке поездки:
          один компонент на два места, поэтому поведение (включая
          подтверждение клиента и тап-таргеты) не расходится. */}
      <DriverTripRequests tripId={tripId} />

      {confirmed.length > 0 && (
        <>
          <Caption
            weight="2"
            Component="p"
            className={styles.passengersGroup}
          >
            {`В поездке (${confirmed.length})`}
          </Caption>
          {confirmed.map((booking) => (
            <Cell
              key={booking.id}
              className={`${styles.requestCell} ${STATIC_CELL}`}
              before={
                <Avatar
                  size={40}
                  src={booking.passenger.avatar}
                  acronym={booking.passenger.name.slice(0, 2).toUpperCase()}
                />
              }
              subtitle={
                <Caption level="1" Component="p" weight="3">
                  {`место №${booking.seat}`}
                </Caption>
              }
            >
              <Subheadline level="2" Component="p" weight="2">
                {booking.passenger.name}
              </Subheadline>
            </Cell>
          ))}
        </>
      )}

      {empty && (
        <Caption Component="p" className={styles.passengersHint}>
          Заявок пока нет
        </Caption>
      )}
    </div>
  );
}
