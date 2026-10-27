import { Avatar, Caption, Subheadline } from "@telegram-apps/telegram-ui";
import { Cell } from "@/ui/Cell";
import { GroupLabel } from "@/ui/GroupLabel";
import { STATIC_CELL } from "@/ui/classes";
import { Button } from "@/ui/Button";
import { FetchMore } from "@/ui/FetchMore";
import { Loading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { mergeUniqueById } from "@/helpers/mergeUniqueById";
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
  const items = mergeUniqueById(query.data?.pages);
  const confirmed = items.filter((booking) => booking.status === "confirmed");
  const pending = pendingCount ?? items.filter((b) => b.status === "pending").length;

  const empty = !query.isLoading && !query.isError && !query.hasNextPage && pending === 0 && confirmed.length === 0;

  return (
    <div className={styles.passengers}>
      {query.isLoading && <Loading label="Загрузка пассажиров" />}
      {query.isError && !query.isFetchNextPageError && (
        <>
          <Notice tone="danger">Не удалось загрузить заявки.</Notice>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Повторить загрузку пассажиров
          </Button>
        </>
      )}

      {pending > 0 && (
        <GroupLabel>{`Ожидают решения (${pending})`}</GroupLabel>
      )}

      {/* Ожидающие решения — ровно те же строки, что в карточке поездки:
          один компонент на два места, поэтому поведение (включая
          подтверждение клиента и тап-таргеты) не расходится. */}
      <DriverTripRequests tripId={tripId} bookings={items} />

      {confirmed.length > 0 && (
        <>
          <GroupLabel>{`В поездке (${confirmed.length})`}</GroupLabel>
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
      <FetchMore
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        error={query.isFetchNextPageError ? query.error : null}
        label="Показать ещё пассажиров"
      />
    </div>
  );
}
