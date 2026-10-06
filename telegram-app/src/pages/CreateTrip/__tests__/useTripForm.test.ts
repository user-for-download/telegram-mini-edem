import { describe, expect, it } from "vitest";
import { type TripTag } from "@edem/contracts";
import {
  initialTripFormState,
  tripFormReducer,
  type TripFormState,
} from "@/pages/CreateTrip/useTripForm";

function state(overrides: Partial<TripFormState> = {}): TripFormState {
  return { ...initialTripFormState(), ...overrides };
}

describe("initialTripFormState", () => {
  it("начальные значения как в форме (завтра, 1 час, 500 ₽, 1 место)", () => {
    const initial = initialTripFormState();
    expect(initial).toMatchObject({
      fromCityId: "",
      toCityId: "",
      fromAddress: "",
      toAddress: "",
      durationHours: "1",
      distanceKm: "",
      price: "500",
      seats: "1",
      comment: "",
      tags: [],
    });
    expect(initial.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("tripFormReducer", () => {
  it("set обновляет поле, остальные не трогает", () => {
    const next = tripFormReducer(state(), {
      type: "set",
      field: "price",
      value: "450",
    });
    expect(next.price).toBe("450");
    expect(next.seats).toBe("1");
  });

  it("set тем же значением возвращает тот же объект", () => {
    const prev = state();
    expect(
      tripFormReducer(prev, { type: "set", field: "price", value: "500" }),
    ).toBe(prev);
  });

  it("swapCities меняет города и адреса парами", () => {
    // Города — id справочника, поэтому и «Вологда» здесь стоит как CITY_A.
    const CITY_A = "11111111-1111-4111-8111-111111111111";
    const CITY_B = "22222222-2222-4222-8222-222222222222";
    const next = tripFormReducer(
      state({
        fromCityId: CITY_A,
        toCityId: CITY_B,
        fromAddress: "A",
        toAddress: "B",
      }),
      { type: "swapCities" },
    );
    expect(next).toMatchObject({
      fromCityId: CITY_B,
      toCityId: CITY_A,
      fromAddress: "B",
      toAddress: "A",
    });
  });

  it("toggleTag добавляет и убирает тег, больше 6 не держит", () => {
    const tag: TripTag = "Тихая поездка";
    const added = tripFormReducer(state(), { type: "toggleTag", tag });
    expect(added.tags).toEqual([tag]);
    const removed = tripFormReducer(added, { type: "toggleTag", tag });
    expect(removed.tags).toEqual([]);
    const full = state({
      tags: [
        "Можно с животными",
        "Можно курить",
        "Есть багаж",
        "Только девушки",
        "Тихая поездка",
        "С остановками",
      ],
    });
    const extra: TripTag = "Разговорчивый";
    const over = tripFormReducer(full, { type: "toggleTag", tag: extra });
    expect(over.tags).toHaveLength(6);
    expect(over.tags).not.toContain(extra);
  });

  it("места задаются обычным set из селекта 1..MAX_SEATS", () => {
    expect(tripFormReducer(state({ seats: "1" }), { type: "set", field: "seats", value: "3" }).seats).toBe("3");
  });
});
