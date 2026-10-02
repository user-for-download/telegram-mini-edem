import type { Trip } from "@edem/contracts";

/**
 * Метка терминального статуса поездки.
 *
 * Поездка в состоянии `active` метку не имеет — она ещё не свернулась.
 * Единый источник для всех мест, где статус показывается текстом: карточка
 * (`TripCard`), архив (`TripHistoryPage`) и шапка деталей (`TripHero`).
 *
 * null = статус не терминальный, показывать «В пути».
 */
export function terminalTripStatusLabel(
  status: Trip["status"] | undefined,
): string | null {
  if (status === "completed") return "Завершена";
  if (status === "cancelled") return "Отменена";
  return null;
}
