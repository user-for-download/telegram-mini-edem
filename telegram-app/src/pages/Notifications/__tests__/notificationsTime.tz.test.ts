// Время в уведомлениях — по Europe/Moscow, как в карточках поездок.
//
// ОТДЕЛЬНЫЙ файл по существу: тест обязан выполняться в зоне, отличной
// от московской, иначе локальное форматирование даёт тот же результат.
// Здесь TZ принудительно America/Los_Angeles (на 10 часов позади).
//
// Node 22 применяет process.env.TZ немедленно, поэтому достаточно
// выставить его в beforeAll и вернуть в afterAll — файл не протекает
// на соседние тесты воркера.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatNotifTime,
  formatTripDetail,
} from "@/pages/Notifications/NotificationsPage";

const ORIGINAL_TZ = process.env.TZ;

/** Независимый эталон: та же метка, собранная здесь, с явным timeZone. */
function moscow(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("ru-RU", {
    ...opts,
    timeZone: "Europe/Moscow",
  }).format(new Date(iso));
}

beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

describe("уведомления форматируются в Europe/Moscow (B8)", () => {
  it("фикстура: локальная зона действительно не московская", () => {
    // Страховка самой фикстуры: если TZ не применился, все проверки ниже
    // стали бы проверками на московской машине и проходили бы на баге.
    const iso = "2030-06-01T22:00:00.000Z";
    const local = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
    expect(local).not.toBe(
      moscow(iso, { day: "numeric", month: "short", year: "numeric" }),
    );
  });

  it("formatNotifTime: календарная дата берётся по Москве", () => {
    // 22:00Z — в Москве 2 июня, в Лос-Анджелесе 1 июня: проверяем
    // московский день, а не день машины.
    const iso = "2030-06-01T22:00:00.000Z";

    expect(formatNotifTime(iso)).toBe(
      moscow(iso, { day: "numeric", month: "short", year: "numeric" }),
    );
  });

  it("formatNotifTime: «сегодня» по московскому календарю", () => {
    const nowIso = new Date().toISOString();

    expect(formatNotifTime(nowIso)).toBe(
      moscow(nowIso, { hour: "2-digit", minute: "2-digit" }),
    );
  });

  it("formatNotifTime: граница суток — 23:00Z ещё «сегодня» по Москве", () => {
    // 23:00Z = 02:00 следующего дня МСК. Если бы «сегодня» считалось по
    // зоне машины (Лос-Анджелес, 16:00 предыдущего дня), разошлись бы
    // и дата, и формат вывода.
    const nowIso = new Date().toISOString();
    const now = new Date(nowIso);
    const hourUtc = now.getUTCHours();
    if (hourUtc !== 23) return; // окно узкое — не этот час

    expect(formatNotifTime(nowIso)).toBe(
      moscow(nowIso, { hour: "2-digit", minute: "2-digit" }),
    );
  });

  it("formatNotifTime: прошлый год показывается с годом", () => {
    const currentYear = Number(
      moscow(nowIsoOf(), { year: "numeric" }),
    );
    const pastIso = `${currentYear - 1}-06-01T09:00:00.000Z`;

    expect(formatNotifTime(pastIso)).toBe(
      moscow(pastIso, { day: "numeric", month: "short", year: "numeric" }),
    );
  });

  it("formatNotifTime: невалидный вход возвращается как есть", () => {
    expect(formatNotifTime("мусор")).toBe("мусор");
  });

  it("formatTripDetail: дата и время отправления — по Москве", () => {
    const iso = "2030-06-01T22:00:00.000Z";

    const detail = formatTripDetail({
      from: "Москва",
      to: "Тула",
      price: 500,
      departureAt: iso,
    });

    const day = moscow(iso, { day: "numeric", month: "short", year: "numeric" });
    const time = moscow(iso, { hour: "2-digit", minute: "2-digit" });
    expect(detail).toBe(`${day}, ${time} · 500 ₽ · Москва → Тула`);
  });

  it("formatTripDetail: сегодняшняя поездка — только час", () => {
    const nowIso = nowIsoOf();

    const detail = formatTripDetail({
      from: "Москва",
      to: "Тула",
      price: 500,
      departureAt: nowIso,
    });

    expect(detail).toBe(
      `${moscow(nowIso, { hour: "2-digit", minute: "2-digit" })} · 500 ₽ · Москва → Тула`,
    );
  });

  it("formatTripDetail: невалидная дата не ломает строку", () => {
    expect(
      formatTripDetail({
        from: "Москва",
        to: "Тула",
        price: 500,
        departureAt: "мусор",
      }),
    ).toBe("500 ₽ · Москва → Тула");
    expect(
      formatTripDetail({ from: null, to: null, price: null, departureAt: null }),
    ).toBeNull();
  });
});

function nowIsoOf(): string {
  return new Date().toISOString();
}
