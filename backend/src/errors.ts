import { ACCOUNT_DELETED_CODE } from "@edem/contracts";

export const ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  TRIP_NOT_ACTIVE: "TRIP_NOT_ACTIVE",
  TRIP_IN_PAST: "TRIP_IN_PAST",
  NO_CAR: "NO_CAR",
  SEAT_TAKEN: "SEAT_TAKEN",
  ALREADY_BOOKED: "ALREADY_BOOKED",
  BOOKING_CONFLICT: "BOOKING_CONFLICT",
  ALREADY_REVIEWED: "ALREADY_REVIEWED",
  NOT_PARTICIPANT: "NOT_PARTICIPANT",
  SELF_REVIEW: "SELF_REVIEW",
  DRIVER_TRIP_OVERLAP: "DRIVER_TRIP_OVERLAP",
  PASSENGER_BOOKING_OVERLAP: "PASSENGER_BOOKING_OVERLAP",
  ACCOUNT_HAS_ACTIVE_OBLIGATIONS: "ACCOUNT_HAS_ACTIVE_OBLIGATIONS",
  /**
   * 403 удалённого аккаунта (`deletedAt`). Раньше делил код `FORBIDDEN` с
   * баном, и клиент различал их ТОЛЬКО по тексту сообщения — стоило бэку
   * переформулировать «Account is deleted», и удалённый аккаунт молча
   * уезжал на плашку бана с предложением обжалования (восстановление при
   * этом невозможно). Отдельный код делает ветвление машинным.
   *
   * Значение берётся из контрактов, а не пишется здесь литералом: по коду
   * ошибки клиент принимает решение, значит это часть контракта, и копия
   * строки в бэке и в клиенте разъехалась бы снова.
   */
  ACCOUNT_DELETED: ACCOUNT_DELETED_CODE,
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

/**
 * Текст 403 удалённого аккаунта. Живёт в контрактах (там же, где клиент
 * берёт его как фолбэк для старого бэка) и пере-экспортируется, чтобы
 * прикладной код бэка импортировал привычный путь из ./errors.js.
 */
export { ACCOUNT_DELETED_MESSAGE } from "@edem/contracts";

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  errors?: unknown;
  // P2034 serialization-конфликты (409) клиент может безопасно повторить.
  retryable?: boolean;
}
