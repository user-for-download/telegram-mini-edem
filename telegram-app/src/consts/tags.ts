// telegram-app/src/consts/tags.ts
// Обязано совпадать с tripTagSchema
// в @edem/contracts (там же — MAX_SEATS и остальные границы).
import type { TripTag } from "@edem/contracts";

/**
 * Лимит условий поездки — эхо `z.array(tripTagSchema).max(6)` из
 * createTripDtoSchema (@edem/contracts). Держим рядом со списком тегов, чтобы
 * UI-гейт (нельзя выбрать седьмой) и редьюсер формы говорили одно число.
 */
export const MAX_TRIP_TAGS = 6;

export const TRIP_TAGS: TripTag[] = [
  "Можно с животными",
  "Можно курить",
  "Есть багаж",
  "Только девушки",
  "Тихая поездка",
  "С остановками",
  "Не курить",
  "Можно с детьми",
  "Разговорчивый",
];
