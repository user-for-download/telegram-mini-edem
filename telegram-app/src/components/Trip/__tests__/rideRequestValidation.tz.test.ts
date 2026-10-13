// Восточный TZ: устройство ВПЕРЕДИ Москвы на 1 час, поэтому наивный
// `new Date("…T08:00")` в валидации заявок уводил окно назад на час.
// Дефект «разбор datetime-local в зоне устройства» воспроизводится только
// на не-московской машине — на московской он невидим, поэтому TZ
// принудительный (паттерн createTripForm.tz.test.ts).
process.env.TZ = "Asia/Dubai";

import { describe, expect, it } from "vitest";
import {
  buildRideRequestDraft,
  validateRideRequestWindow,
  type RideRequestDraft,
} from "@/components/Trip/rideRequestValidation";

const CITIES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Вологда" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Тула" },
] as const;

const DRAFT = {
  fromCityId: CITIES[0].id,
  toCityId: CITIES[1].id,
  // Пассажир набирает 08:00–20:00 — по Москве, как показывает ему лента.
  earliest: "2026-11-20T08:00",
  latest: "2026-11-20T20:00",
  seats: "2",
} satisfies RideRequestDraft;

describe("buildRideRequestDraft: окно заявки записывается по Москве, не по устройству", () => {
  it("кладёт в DTO московские моменты, а не сдвинутые зоной устройства", () => {
    const result = buildRideRequestDraft(DRAFT, CITIES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 08:00 МСК = 05:00Z, 20:00 МСК = 17:00Z. Наивный разбор в Дубае давал
    // 04:00Z/16:00Z — окно уезжало на час раньше введённого.
    expect(result.dto.earliestAt).toBe("2026-11-20T05:00:00.000Z");
    expect(result.dto.latestAt).toBe("2026-11-20T17:00:00.000Z");
    expect(result.dto.expiresAt).toBe("2026-11-20T17:00:00.000Z");
    expect(result.routeLabel).toBe("Вологда → Тула");
  });

  it("окно через полночь МСК держит введённый день", () => {
    const result = buildRideRequestDraft(
      { ...DRAFT, earliest: "2026-11-20T00:30", latest: "2026-11-20T08:00" },
      CITIES,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 00:30 МСК = 21:30Z предыдущего дня UTC.
    expect(result.dto.earliestAt).toBe("2026-11-19T21:30:00.000Z");
  });
});

describe("validateRideRequestWindow: сравнение моментов по Москве", () => {
  it("принимает корректное окно", () => {
    expect(
      validateRideRequestWindow("2026-11-20T08:00", "2026-11-20T20:00"),
    ).toBeNull();
  });

  it("отклоняет перевёрнутое окно по-русски", () => {
    expect(
      validateRideRequestWindow("2026-11-20T20:00", "2026-11-20T08:00"),
    ).toBe("«Не позже» должно быть позже «Не раньше»");
  });

  it("отклоняет мусор по-русски, а не исключением", () => {
    expect(validateRideRequestWindow("", "2026-11-20T20:00")).toBe(
      "Выберите временной интервал",
    );
  });
});
