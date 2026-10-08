import { describe, expect, it } from "vitest";
import { type TripTag } from "@edem/contracts";
import {
  initialTripFormState,
  isTripFormDirty,
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

  it("флаги опций стартуют с дефолтов контракта", () => {
    // autoComplete=false — автозавершение по TTL +24ч (текущее поведение),
    // matchingEnabled=true — безусловный подбор пассажиров (текущее поведение).
    // Инверсия дефолта тихо поменяла бы семантику для всех новых поездок.
    expect(initialTripFormState().autoComplete).toBe(false);
    expect(initialTripFormState().matchingEnabled).toBe(true);
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

  it("флаги опций переключаются обычным set", () => {
    const on = tripFormReducer(state(), {
      type: "set",
      field: "autoComplete",
      value: true,
    });
    expect(on.autoComplete).toBe(true);
    const off = tripFormReducer(on, {
      type: "set",
      field: "matchingEnabled",
      value: false,
    });
    expect(off.matchingEnabled).toBe(false);
    // Остальные поля не поехали.
    expect(off.seats).toBe("1");
  });

  it("set флага тем же значением возвращает тот же объект", () => {
    const prev = state();
    expect(
      tripFormReducer(prev, { type: "set", field: "matchingEnabled", value: true }),
    ).toBe(prev);
  });
});

describe("isTripFormDirty", () => {
  it("чистая форма — не черновик", () => {
    const initial = initialTripFormState();
    expect(isTripFormDirty(initial, initial)).toBe(false);
  });

  it("переключение опции делает форму черновиком", () => {
    // Регрессия: без флагов в сравнении переключатель не считался бы
    // изменением, и useClosingConfirmation молчал бы — водитель потерял бы
    // выбор опции при выходе из формы.
    const initial = initialTripFormState();
    const toggled = tripFormReducer(initial, {
      type: "set",
      field: "matchingEnabled",
      value: false,
    });
    expect(isTripFormDirty(toggled, initial)).toBe(true);
  });

  it("переключение второй опции тоже черновик", () => {
    const initial = initialTripFormState();
    const toggled = tripFormReducer(initial, {
      type: "set",
      field: "autoComplete",
      value: true,
    });
    expect(isTripFormDirty(toggled, initial)).toBe(true);
  });

  it("возврат к начальному значению снова делает форму чистой", () => {
    const initial = initialTripFormState();
    const toggled = tripFormReducer(initial, {
      type: "set",
      field: "autoComplete",
      value: true,
    });
    const restored = tripFormReducer(toggled, {
      type: "set",
      field: "autoComplete",
      value: false,
    });
    expect(isTripFormDirty(restored, initial)).toBe(false);
  });

  it("форма без флагов в сравнении — тест на откат полей", () => {
    // Фикстура для проверки падения: если из isTripFormDirty выкинуть оба
    // флага, первый «переключение опции делает форму черновиком» упадёт.
    const initial = initialTripFormState();
    expect(isTripFormDirty({ ...initial, autoComplete: true }, initial)).toBe(true);
    expect(isTripFormDirty({ ...initial, matchingEnabled: false }, initial)).toBe(true);
  });
});
