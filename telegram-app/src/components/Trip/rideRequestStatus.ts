/**
 * Подпись, тон и «фактический» статус заявки на попутку.
 *
 * Статус нужен и строке списка, и шторке управления, поэтому он живёт здесь,
 * а не в одном из потребителей: иначе две копии разошлись бы в тексте или
 * цвете. Сырое перечисление бэкенда пользователю не показываем.
 */
import type { RideRequest, RideRequestStatus } from "@edem/contracts";
import type { StatusTone } from "@/components/StatusPill/StatusPill";
import { isRideRequestExpired } from "./rideRequestValidation";

export const RIDE_REQUEST_STATUS_LABELS: Readonly<
  Record<RideRequestStatus, string>
> = {
  active: "Активен",
  paused: "На паузе",
  fulfilled: "Выполнен",
  expired: "Истёк",
  cancelled: "Отменён",
};

export const RIDE_REQUEST_STATUS_TONES: Readonly<
  Record<RideRequestStatus, StatusTone>
> = {
  active: "success",
  paused: "warning",
  fulfilled: "info",
  expired: "info",
  cancelled: "danger",
};

/**
 * Фактический статус для UI.
 *
 * Статус `expired` не спасает: его пишет только сид — ни воркер, ни админский
 * маршрут этого не делают. Поэтому у живой заявки срок считаем сами. У
 * терминальных статусов срок уже не важен: отменённая заявка не должна
 * превращаться в «Истёк» после даты `expiresAt`.
 */
export function rideRequestViewStatus(
  request: Pick<RideRequest, "status" | "expiresAt">,
  now: Date = new Date(),
): RideRequestStatus {
  if (
    (request.status === "active" || request.status === "paused") &&
    isRideRequestExpired(request, now)
  ) {
    return "expired";
  }
  return request.status;
}
