import {
  Avatar,
  Button,
  Caption,
  Placeholder,
  Section,
  Spinner,
  Text,
} from "@telegram-apps/telegram-ui";
import { FeedCard } from "@/components/FeedCard";
import { StatusPill } from "@/components/StatusPill";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import {
  bookingErrorMessage,
  isAuthorizationError,
} from "@/helpers/bookingErrors";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  useTripBookingsQuery,
  useUpdateBookingStatusMutation,
} from "@/queries/useBookingsQuery";

/**
 * Заявки пассажиров (паритет VK TripDetailsPanel: управление заявками +
 * подтверждённые пассажиры). Бэкенд driver-only: чужой deep-link → 403
 * с явным authorization-состоянием.
 */
export function TripRequestsPage() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const requests = useTripBookingsQuery(tripId);
  const update = useUpdateBookingStatusMutation();
  const { isOnline } = useOnlineStatus();

  if (requests.isLoading) {
    return (
      <>
        <PageHeader title="Заявки пассажиров" />
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      </>
    );
  }
  if (requests.isError) {
    const forbidden = isAuthorizationError(requests.error);
    return (
      <>
        <PageHeader title="Заявки пассажиров" />
        <OfflineBanner />
        <Placeholder
          header={forbidden ? "Нет доступа" : "Не удалось загрузить заявки"}
          description={
            forbidden
              ? "Заявки видит только водитель поездки."
              : bookingErrorMessage(requests.error)
          }
          action={
            <>
              {!forbidden && (
                <Button
                  mode="bezeled"
                  stretched
                  onClick={() => void requests.refetch()}
                >
                  Повторить
                </Button>
              )}
              <Button
                mode="outline"
                stretched
                onClick={() => navigate("/bookings?segment=driver")}
              >
                К моим поездкам
              </Button>
            </>
          }
        >
          {!isOnline && <p>Проверьте подключение к интернету.</p>}
        </Placeholder>
      </>
    );
  }

  const items = requests.data?.pages.flatMap((page) => page.items) ?? [];
  const pending = items.filter((booking) => booking.status === "pending");
  const confirmed = items.filter((booking) => booking.status === "confirmed");

  return (
    <>
      <PageHeader title="Заявки пассажиров" />
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
        {update.error && (
          <Caption
            Component="p"
            role="alert"
            className="text-(--tg-theme-destructive-text-color)"
          >
            {bookingErrorMessage(update.error)}
          </Caption>
        )}
        {!items.length && <Placeholder header="Заявок нет" />}
        {pending.length > 0 && (
          <Section header={`Ожидают решения (${pending.length})`}>
            <div className="flex flex-col gap-3 p-4">
              {pending.map((booking) => (
                <FeedCard key={booking.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar
                        size={40}
                        src={booking.passenger.avatar}
                        acronym={booking.passenger.name
                          .slice(0, 1)
                          .toUpperCase()}
                      />
                      <div className="min-w-0">
                        <Text Component="div" className="truncate">
                          {booking.passenger.name}
                        </Text>
                        <Caption Component="div">
                          {`место ${booking.seat}${booking.comment ? ` · «${booking.comment}»` : ""}`}
                        </Caption>
                      </div>
                    </div>
                    <StatusPill tone="warning" className="shrink-0">
                      Ожидает решения
                    </StatusPill>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      mode="bezeled"
                      stretched
                      size="s"
                      loading={
                        update.isPending && update.variables?.id === booking.id
                      }
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({ id: booking.id, status: "confirmed" })
                      }
                    >
                      Принять
                    </Button>
                    <Button
                      mode="bezeled"
                      stretched
                      size="s"
                      loading={
                        update.isPending && update.variables?.id === booking.id
                      }
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({ id: booking.id, status: "declined" })
                      }
                    >
                      Отклонить
                    </Button>
                  </div>
                </FeedCard>
              ))}
            </div>
          </Section>
        )}
        {confirmed.length > 0 && (
          <Section header={`Подтверждены (${confirmed.length})`}>
            <div className="flex flex-col gap-3 p-4">
              {confirmed.map((booking) => (
                <FeedCard
                  key={booking.id}
                  className="p-4 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar
                      size={40}
                      src={booking.passenger.avatar}
                      acronym={booking.passenger.name.slice(0, 1).toUpperCase()}
                    />
                    <div className="min-w-0">
                      <Text Component="div" className="truncate">
                        {booking.passenger.name}
                      </Text>
                      <Caption Component="div">
                        {`место ${booking.seat}`}
                      </Caption>
                    </div>
                  </div>
                  <StatusPill tone="success" className="shrink-0">
                    Подтверждён
                  </StatusPill>
                </FeedCard>
              ))}
            </div>
          </Section>
        )}
        {requests.hasNextPage && (
          <Button
            stretched
            mode="bezeled"
            onClick={() => void requests.fetchNextPage()}
            disabled={requests.isFetchingNextPage}
          >
            Показать ещё
          </Button>
        )}
        <Button
          mode="bezeled"
          stretched
          onClick={() => navigate("/bookings?segment=driver")}
        >
          К моим поездкам
        </Button>
      </div>
    </>
  );
}
