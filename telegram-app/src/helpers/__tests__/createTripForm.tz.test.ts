// Восточный TZ: устройство ВПЕРЕДИ Москвы, поэтому наивный
// `new Date("…T08:00")` уводит отправление назад на 4 часа. Дефект
// «разбор datetime-local в зоне устройства» воспроизводится только на
// не-московской машине — на московской он невидим.
process.env.TZ = "Asia/Dubai";

import { describe, expect, it } from "vitest";
import {
  validateCreateTripDraft,
  type CreateTripDraft,
} from "@/helpers/createTripForm";

const CITIES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Вологда" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Череповец" },
] as const;

const DRAFT = {
  fromCityId: CITIES[0].id,
  toCityId: CITIES[1].id,
  fromAddress: "пл. Бабушкина, 1",
  toAddress: "пр. Победы, 1",
  // Водитель набирает 08:00 — по Москве, как показывает ему лента.
  date: "2026-10-20T08:00",
  durationHours: "2",
  distanceKm: "140",
  price: "450",
  seats: "2",
  tags: [],
  comment: "",
} satisfies CreateTripDraft;

const NOW = new Date("2026-10-19T10:00:00.000Z");

describe("validateCreateTripDraft: отправление записывается по Москве, не по устройству", () => {
  it("keeps the entered wall clock instead of shifting it by the device offset", () => {
    const result = validateCreateTripDraft(DRAFT, CITIES, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 08:00 МСК = 05:00Z. Наивный разбор в Дубае дал 04:00Z — на час раньше.
    expect(result.data.departureAt).toBe("2026-10-20T05:00:00.000Z");
  });

  it("treats a midnight wall clock as the start of the entered Moscow day", () => {
    const result = validateCreateTripDraft(
      { ...DRAFT, date: "2026-10-20T00:30" },
      CITIES,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 00:30 МСК = 20.10 21:30Z предыдущего дня UTC.
    expect(result.data.departureAt).toBe("2026-10-19T21:30:00.000Z");
  });

  it("rejects an unparseable date instead of publishing a shifted one", () => {
    const result = validateCreateTripDraft({ ...DRAFT, date: "" }, CITIES, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe("create-date");
  });
});
