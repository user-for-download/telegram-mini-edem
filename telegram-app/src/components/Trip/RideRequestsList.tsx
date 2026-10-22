import { memo, useState } from "react";
import { IconContainer } from "@telegram-apps/telegram-ui";
import { ChevronRight, Route } from "lucide-react";
import type { RideRequest } from "@edem/contracts";

import { QueryState } from "@/components/QueryState";
import { Cell } from "@/ui/Cell";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { FetchMore } from "@/ui/FetchMore";
import { Section } from "@/ui/Section";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { useRideRequestsQuery } from "@/queries/useRideRequestsQuery";
import { mergeUniqueById } from "@/helpers/mergeUniqueById";
import { listBlockingError } from "@/helpers/listBlockingError";
import { haptic } from "@/utils/haptics";
import { formatMoscowDateTimeRange } from "@/utils/date";
import { plural } from "@/utils/plural";
import { useModalBack } from "@/utils/modalBack";
import { RideRequestDetailsModal } from "./RideRequestDetailsModal";
import {
  RIDE_REQUEST_STATUS_LABELS,
  RIDE_REQUEST_STATUS_TONES,
  rideRequestViewStatus,
} from "./rideRequestStatus";
import styles from "./TripModals.module.css";

const RideRequestCell = memo(function RideRequestCell({
  request,
  onOpen,
}: {
  request: RideRequest;
  onOpen: (id: string) => void;
}) {
  const shownStatus = rideRequestViewStatus(request);
  const statusLabel = RIDE_REQUEST_STATUS_LABELS[shownStatus];
  const window = formatMoscowDateTimeRange(
    request.earliestAt,
    request.latestAt,
  );
  const seats = `${request.seats} ${plural(request.seats, "место", "места", "мест")}`;

  return (
    <Cell
      className={styles.requestCell}
      Component="button"
      type="button"
      before={
        <IconContainer>
          <Route size={22} />
        </IconContainer>
      }
      subtitle={window}
      description={
        <>
          <span
            className={styles.requestStatus}
            data-tone={RIDE_REQUEST_STATUS_TONES[shownStatus]}
          >
            {statusLabel}
          </span>
          <span className={styles.requestSeats}>{` · ${seats}`}</span>
        </>
      }
      after={
        <ChevronRight size={16} className={styles.requestChevron} aria-hidden />
      }
      aria-label={`Запрос ${request.fromCity.name} — ${request.toCity.name}. ${window}. ${statusLabel}. ${seats}. Открыть управление`}
      data-testid={`ride-request-cell-${request.id}`}
      onClick={() => {
        haptic.light();
        onOpen(request.id);
      }}
    >
      {`${request.fromCity.name} → ${request.toCity.name}`}
    </Cell>
  );
});

/**
 * Список своих запросов на попутку — тело страницы «История запросов»
 * (`/profile/ride-requests`).
 *
 * Строка — `Cell`, как в уведомлениях/истории поездок: список отвечает только
 * за выбор запроса, а управление (пауза/возобновление, правка, удаление)
 * живёт в шторке `RideRequestDetailsModal`. Раньше действия были встроены в
 * карточки и занимали три строки на каждую заявку.
 *
 * Секция без заголовка: имя экрана уже стоит в NavHeader, и заголовок
 * «Мои заявки» был третьим названием одной и той же ленты (после пункта
 * профиля и шапки). Так же устроены «История поездок» и «Уведомления».
 *
 * Раскладка — как у уведомлений: `Section` — прямой ребёнок `Page`, строки —
 * прямые дети `Section`. Обёртка `SectionBody` давала второй горизонтальный
 * паддинг (16 страницы + 16 тела), поэтому лента была заметно уже остальных
 * экранов; китовый `Section` сам вставляет `Divider` между строками.
 *
 * Back закрывает шторку через `useModalBack`: окно state-модальное, у него
 * нет собственного роута.
 */
export const RideRequestsList = memo(function RideRequestsList() {
  const requests = useRideRequestsQuery();
  // Бесконечная лента: свои заявки копятся (терминальные остаются в
  // истории), поэтому список обязан уметь догружать страницы — раньше
  // pagination выбрасывалась и было видно только первые 20.
  // mergeUniqueById, а не flatMap: /ride-requests — offset-пагинация
  // (skip/take) по списку, в который новая заявка встаёт В НАЧАЛО и сдвигает
  // окно, поэтому граничная строка приезжала второй раз и карточка
  // дублировалась (React ругался на повторный key).
  const items = mergeUniqueById(requests.data?.pages);
  const isEmpty = items.length === 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Держим id, а не объект: после мутации инвалидация обновит страницы, и
  // шторка перерисуется по свежим данным, а не по устаревшей копии.
  const selected = items.find((request) => request.id === selectedId) ?? null;

  useModalBack(() => setSelectedId(null), selected !== null);

  const sentinelRef = useInfiniteSentinel({
    hasNextPage: requests.hasNextPage,
    isFetchingNextPage: requests.isFetchingNextPage,
    // Пятый вызов хука в приложении: те же четыре ленты уже передают
    // `disabled`, эта — нет. После сбоя страницы N+1 hasNextPage остаётся
    // истинным, а плейсхолдер возвращает сентинел во вьюпорт — observer
    // бил бы по кругу (MEMORY.md §18).
    disabled: requests.isFetchNextPageError,
    fetchNextPage: () => {
      void requests.fetchNextPage();
    },
  });

  return (
    <>
      <QueryState
        loading={requests.isLoading}
        error={listBlockingError(requests)}
        // Пустое состояние — та же ветка QueryState, что у истории поездок:
        // «Пока пусто» + описание, без внутреннего заголовка и без действия.
        empty={isEmpty}
        emptyText={EMPTY_STATES.rideRequestsEmpty.description}
        onRetry={() => void requests.refetch()}
      >
        <Section>
          {items.map((request) => (
            <RideRequestCell
              key={request.id}
              request={request}
              onOpen={setSelectedId}
            />
          ))}
        </Section>
        <FetchMore
          hasNextPage={requests.hasNextPage}
          isFetchingNextPage={requests.isFetchingNextPage}
          fetchNextPage={() => void requests.fetchNextPage()}
          error={requests.isFetchNextPageError ? requests.error : null}
          sentinelRef={sentinelRef}
        />
      </QueryState>
      <RideRequestDetailsModal
        request={selected}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
});
