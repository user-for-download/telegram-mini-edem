import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@edem/contracts";
import { groupTripsByDay } from "@/helpers/tripGroups";

// Фикстуры повторяют реальный ответ бэка: `date` — уже отформатированная
// подпись «сб, 15 марта» (`formatDateRu`), ISO-дата есть только в
// `departureAt`. Фикстура с ISO в `date` проверяла бы несуществующий контракт.
function makeTrip(id: string, departureAt: string | undefined): Trip {
  return {
    id,
    fromCity: "Вологда",
    toCity: "Череповец",
    date: "",
    time: "10:00",
    departureAt,
    durationMinutes: 120,
    distanceKm: 180,
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    driver: {
      id: "u-driver",
      name: "Иван Водителев",
      avatar: "https://t.me/i/userpic/320/avatar.svg",
      rating: 4.8,
      reviewsCount: 1,
      tripsCount: 5,
    },
    tags: [],
  };
}

/** Подпись бэка для фикстуры — чтобы тесты падали так же, как в проде. */
function backendDate(departureAt: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(departureAt));
}

function trip(id: string, departureAt: string): Trip {
  const base = makeTrip(id, departureAt);
  return { ...base, date: backendDate(departureAt) };
}

describe("groupTripsByDay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("пусто → нет групп", () => {
    expect(groupTripsByDay([])).toEqual([]);
  });

  it("день берётся из departureAt, а не из подписи бэка", () => {
    // Дата бэка — «сб, 12 сентября»: по ней как по ISO dayLabel() не поймал бы
    // «Сегодня». Ключ обязан быть посчитан по московскому дню.
    const [group] = groupTripsByDay([trip("t-1", "2026-09-12T06:00:00.000Z")]);
    expect(group?.key).toBe("2026-09-12");
    expect(group?.label).toBe("Сегодня");
  });

  it("один день → одна группа, порядок карточек сохранён", () => {
    const groups = groupTripsByDay([
      trip("t-1", "2026-09-12T06:00:00.000Z"),
      trip("t-2", "2026-09-12T09:00:00.000Z"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.trips.map((t) => t.id)).toEqual(["t-1", "t-2"]);
  });

  it("соседние дни → группы по порядку", () => {
    const groups = groupTripsByDay([
      trip("t-1", "2026-09-12T06:00:00.000Z"),
      trip("t-2", "2026-09-13T06:00:00.000Z"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-12", "2026-09-13"]);
    expect(groups.map((g) => g.label)).toEqual(["Сегодня", "Завтра"]);
  });

  it("день, разорванный другим днём, НЕ переставляет карточки", () => {
    // Регресс на `Map`-группировку: она отдала бы 12:[t-1,t-3], 13:[t-2] и
    // переставила выдачу. Накопление по соседям держит исходный порядок.
    const groups = groupTripsByDay([
      trip("t-1", "2026-09-12T06:00:00.000Z"),
      trip("t-2", "2026-09-13T06:00:00.000Z"),
      trip("t-3", "2026-09-12T09:00:00.000Z"),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "2026-09-12",
      "2026-09-13",
      "2026-09-12",
    ]);
    expect(groups.flatMap((g) => g.trips.map((t) => t.id))).toEqual([
      "t-1",
      "t-2",
      "t-3",
    ]);
  });

  it("московская ночь: 02:30 МСК — уже следующий день", () => {
    // 22:30 UTC = 01:30 МСК 13-го. Группировать по дате UTC было бы на день
    // позже (ошибка на часовой пояс, заметная у клиента не в МСК).
    const groups = groupTripsByDay([
      trip("t-1", "2026-09-12T21:30:00.000Z"),
      trip("t-2", "2026-09-13T22:30:00.000Z"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-13", "2026-09-14"]);
  });

  it("подпись дальних дат — «день месяц» без года", () => {
    const [group] = groupTripsByDay([trip("t-1", "2031-03-15T06:00:00.000Z")]);
    expect(group?.label).toBe("15 марта");
  });

  it("без departureAt карточка не теряется: группа по подписи бэка", () => {
    const groups = groupTripsByDay([
      { ...makeTrip("t-1", undefined), date: "сб, 12 сентября" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("сб, 12 сентября");
    expect(groups[0]?.trips.map((t) => t.id)).toEqual(["t-1"]);
  });

  it("мусорный departureAt не теряет карточку", () => {
    const groups = groupTripsByDay([
      { ...makeTrip("t-1", "не дата"), date: "сб, 12 сентября" },
    ]);
    expect(groups[0]?.key).toBe("сб, 12 сентября");
    expect(groups[0]?.trips).toHaveLength(1);
  });
});