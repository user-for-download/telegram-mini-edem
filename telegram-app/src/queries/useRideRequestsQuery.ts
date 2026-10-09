import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  rideRequestsApi,
  type MutableRideRequestStatus,
} from "@/api/rideRequests.api";
import type {
  CreateRideRequestDto,
  UpdateRideRequestDto,
} from "@edem/contracts";

export const RIDE_REQUEST_KEYS = {
  all: ["ride-requests"] as const,
  trip: (tripId: string) =>
    [...RIDE_REQUEST_KEYS.all, "trip", tripId] as const,
};

/**
 * Лента заявок попутчиков для главной: чужие активные, ближайшее окно сверху.
 *
 * Отдельный ключ, а не `RIDE_REQUEST_KEYS.all`: лента и список моих заявок —
 * разные данные с разным временем жизни. Пересчитывать список после публикации
 * (как это делает `useRideRequestMutation`) здесь незачем — заявок чужих мы не
 * создаём и не отменяем.
 */
export function useRideRequestFeedQuery(enabled = true) {
  return useQuery({
    queryKey: [...RIDE_REQUEST_KEYS.all, "feed"] as const,
    queryFn: ({ signal }) => rideRequestsApi.feed(signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useRideRequestsQuery(enabled = true) {
  return useInfiniteQuery({
    // Ключ под RIDE_REQUEST_KEYS.all: инвалидация мутаций заявок по
    // префиксу `all` обновляет и этот список без отдельной правки.
    queryKey: [...RIDE_REQUEST_KEYS.all, "mine", "infinite"] as const,
    queryFn: ({ pageParam, signal }) =>
      rideRequestsApi.list(pageParam, 20, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Спрос на СВОЮ поездку (`GET /trips/:id/requests`): активные заявки других
 * людей, совпадающие по маршруту и окну. Видно только водителю (бэк отдаёт
 * 403 остальным, 404 — несуществующей поездке), поэтому вызывающий читает
 * ошибку и пустой ответ одинаково: спроса нет.
 *
 * Ключ под `RIDE_REQUEST_KEYS.all`, а не под `TRIP_KEYS`: инвалидация по
 * префиксу в `useRideRequestMutation` тогда сама обновляет карточку спроса,
 * когда пассажир публикует, снимает или закрывает свою заявку. Импорт
 * `TRIP_KEYS` сюда дал бы лишнюю связь между модулями запросов.
 *
 * `retry: false`: 403 и 404 не меняются повтором, а дефолтные три ретрая
 * только грузили бы список поездок — на каждую карточку водителя.
 */
export function useTripDemandQuery(
  tripId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: RIDE_REQUEST_KEYS.trip(tripId),
    queryFn: ({ signal }) => rideRequestsApi.forTrip(tripId, signal),
    enabled: Boolean(tripId) && (options?.enabled ?? true),
    staleTime: 30_000,
    retry: false,
  });
}

function useRideRequestMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: RIDE_REQUEST_KEYS.all }),
  });
}

export function useCreateRideRequestMutation() {
  return useRideRequestMutation((data: CreateRideRequestDto) =>
    rideRequestsApi.create(data),
  );
}

export function useUpdateRideRequestMutation() {
  return useRideRequestMutation(
    ({ id, data }: { id: string; data: UpdateRideRequestDto }) =>
      rideRequestsApi.update(id, data),
  );
}

export function useRideRequestStatusMutation() {
  return useRideRequestMutation(
    ({ id, status }: { id: string; status: MutableRideRequestStatus }) =>
      rideRequestsApi.setStatus(id, status),
  );
}

export function useCancelRideRequestMutation() {
  return useRideRequestMutation((id: string) => rideRequestsApi.cancel(id));
}

/**
 * Приглашение пассажира в поездку водителя: уходит одно уведомление
 * `driver_invite`, бронь НЕ создаётся (решение владельца продукта).
 *
 * Инвалидации `RIDE_REQUEST_KEYS.all` здесь нет намеренно — общий хук её
 * добавляет всем мутациям заявок, а приглашение заявку не меняет: она остаётся
 * активной, и того же человека водитель вправе позвать ещё и в другую поездку.
 * Карточке спроса нечего обновлять, а лишний запрос на каждое нажатие водителю
 * не нужен.
 */
export function useInviteRideRequestMutation() {
  return useMutation({
    mutationFn: ({
      requestId,
      tripId,
    }: {
      requestId: string;
      tripId: string;
    }) => rideRequestsApi.invite(requestId, tripId),
  });
}
