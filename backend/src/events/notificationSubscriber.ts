// backend/src/events/notificationSubscriber.ts
//
// Подписчик уведомлений на доменные события: маппинг «событие → notifyUser».
//
// Оформительский текст (type/title/body/fragment/action/role) живёт ТОЛЬКО
// здесь, а не в роутах: точка мутации сообщает факты через emit, а как
// они выглядят в инбоксе — решает подписчик. Строки перенесены 1:1 из
// прежних ручных вызовов (bookings/create.ts, bookings/status.ts,
// trips/index.ts), поведение для пользователя не меняется.
//
// Регистрация — один раз (registerNotificationSubscribers в app.ts):
// флаг идемпотентности страхует от двойного импорта, а Map слушателей
// не плодит дубликаты при повторной регистрации тех же функций.
import { domainEvents, type DomainEvents } from "./domainEvents.js";
import {
  notifyUser,
  tripSnapshotOf,
} from "../services/notification.service.js";

async function onBookingCreated(
  payload: DomainEvents["booking.created"],
): Promise<void> {
  await notifyUser({
    userId: payload.driverId,
    type: "booking_created",
    title: "Новая заявка на место",
    body:
      `Получена новая заявка на место ${payload.seat} в поездке ` +
      `${payload.trip.fromCity} → ${payload.trip.toCity}`,
    // Тап открывает шторку деталей поездки водителя.
    fragment: `/trips/${payload.tripId}`,
    // Вторая строка — «имя • действие», третья — снапшот поездки.
    actorName: payload.passengerName,
    action: "created",
    tripSnapshot: tripSnapshotOf(payload.trip),
    // Получатель — водитель поездки.
    role: "driver",
  });
}

async function onBookingStatusChanged(
  payload: DomainEvents["booking.status_changed"],
): Promise<void> {
  const confirmed = payload.newStatus === "confirmed";
  await notifyUser({
    userId: payload.passengerId,
    type: "booking_status_changed",
    title: confirmed ? "Заявка подтверждена" : "Заявка отклонена",
    body:
      `Водитель ${confirmed ? "подтвердил" : "отклонил"} вашу заявку ` +
      `в поездке ${payload.trip.fromCity} → ${payload.trip.toCity}`,
    // Тап открывает шторку деталей поездки.
    fragment: `/trips/${payload.tripId}`,
    // Вторая строка — «имя • действие», третья — снапшот поездки.
    actorName: payload.driverName,
    action: payload.newStatus,
    tripSnapshot: tripSnapshotOf(payload.trip),
    // Получатель — пассажир (автор заявки).
    role: "passenger",
  });
}

async function onTripCancelled(
  payload: DomainEvents["trip.cancelled"],
): Promise<void> {
  // notifyUser глотает ошибки внутри, поэтому параллелим безопасно
  // (тот же приём, что был в ручном вызове trips/index.ts).
  await Promise.all(
    payload.passengerIds.map((passengerId) =>
      notifyUser({
        userId: passengerId,
        type: "trip_cancelled",
        title: "Поездка отменена",
        body:
          `Водитель отменил поездку ${payload.trip.fromCity} → ` +
          `${payload.trip.toCity}`,
        // Тап открывает шторку деталей отменённой поездки.
        fragment: `/trips/${payload.tripId}`,
        // Вторая строка — «имя • действие», третья — снапшот поездки.
        actorName: payload.driverName,
        action: "cancelled",
        tripSnapshot: tripSnapshotOf(payload.trip),
        // Получатели — пассажиры отменённой поездки.
        role: "passenger",
      }),
    ),
  );
}

let registered = false;

/**
 * Подписать уведомления на доменные события. Вызывается один раз при
 * старте (app.ts — его импортируют и сервер, и тесты; index.ts тесты
 * не грузят, поэтому регистрация там оставила бы тесты без подписок).
 */
export function registerNotificationSubscribers(): void {
  if (registered) return;
  registered = true;
  domainEvents.on("booking.created", onBookingCreated);
  domainEvents.on("booking.status_changed", onBookingStatusChanged);
  domainEvents.on("trip.cancelled", onTripCancelled);
}
