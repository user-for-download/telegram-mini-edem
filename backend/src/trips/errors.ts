// backend/src/trips/errors.ts
// Ошибки бизнес-логики поездок. TripError прокидывается из транзакций
// (где нельзя просто вернуть c.json) и ловится в роутере, превращаясь
// в JSON-ответ с корректным code/status.
import { ERROR_CODES } from "../errors.js";

export interface TripErrorKind {
  code: string;
  status: number;
}

export const TripErrors = {
  notFound: (): TripErrorKind => ({ code: ERROR_CODES.NOT_FOUND, status: 404 }),
  forbidden: (): TripErrorKind => ({ code: ERROR_CODES.FORBIDDEN, status: 403 }),
  notActive: (): TripErrorKind => ({ code: ERROR_CODES.TRIP_NOT_ACTIVE, status: 400 }),
  noCar: (): TripErrorKind => ({ code: ERROR_CODES.NO_CAR, status: 400 }),
  notStarted: (): TripErrorKind => ({ code: ERROR_CODES.TRIP_IN_PAST, status: 400 }),
  // Поездка уже уехала: состояние необратимо (409), в отличие от
  // notStarted — попытки создать/завершить поездку в прошлом (400).
  departed: (): TripErrorKind => ({ code: ERROR_CODES.TRIP_IN_PAST, status: 409 }),
  conflict: (): TripErrorKind => ({ code: ERROR_CODES.CONFLICT, status: 409 }),
  overlap: (): TripErrorKind => ({ code: ERROR_CODES.DRIVER_TRIP_OVERLAP, status: 409 }),
  passengerOverlap: (): TripErrorKind => ({
    code: ERROR_CODES.PASSENGER_BOOKING_OVERLAP,
    status: 409,
  }),
  invalidSeats: (): TripErrorKind => ({ code: ERROR_CODES.VALIDATION_FAILED, status: 400 }),
  // FK на City не найден: либо id удалён, либо fromCityId/toCityId
  // подделан клиентом. Возвращаем 400, потому что это валидационная
  // ошибка (UI всегда присылает id из /cities/suggest).
  cityNotFound: (): TripErrorKind => ({ code: ERROR_CODES.VALIDATION_FAILED, status: 400 }),
} as const;

export class TripError extends Error {
  constructor(
    readonly kind: TripErrorKind,
    message: string
  ) {
    super(message);
    this.name = "TripError";
  }

  get code(): string {
    return this.kind.code;
  }

  get status(): number {
    return this.kind.status;
  }
}
