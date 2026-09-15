import { describe, expect, it } from "vitest";
import { filterCities, findExactCity } from "@/components/CityPickerField";

const CITIES = [
  { id: "1", name: "Вологда" },
  { id: "2", name: "Череповец" },
  { id: "3", name: "Великий Устюг" },
  { id: "4", name: "Волоколамск" },
];

describe("filterCities", () => {
  it("пустой запрос — весь справочник", () => {
    expect(filterCities(CITIES, "")).toEqual(CITIES);
    expect(filterCities(CITIES, "   ")).toEqual(CITIES);
  });

  it("подстрока без учёта регистра", () => {
    expect(filterCities(CITIES, "вол").map((c) => c.name)).toEqual([
      "Вологда",
      "Волоколамск",
    ]);
    expect(filterCities(CITIES, "ЧЕРЕП").map((c) => c.name)).toEqual([
      "Череповец",
    ]);
  });

  it("нет совпадений — пусто (форма покажет подсказку)", () => {
    expect(filterCities(CITIES, "Москва")).toEqual([]);
  });

  it("без справочника — пусто", () => {
    expect(filterCities(undefined, "вол")).toEqual([]);
  });
});

describe("findExactCity", () => {
  it("полное имя — находится (trim + case-insensitive)", () => {
    expect(findExactCity(CITIES, "Вологда")?.id).toBe("1");
    expect(findExactCity(CITIES, "  череповец  ")?.id).toBe("2");
  });

  it("подстрока — не точное совпадение", () => {
    expect(findExactCity(CITIES, "Вол")).toBeNull();
    expect(findExactCity(CITIES, "")).toBeNull();
    expect(findExactCity(CITIES, "Москва")).toBeNull();
    expect(findExactCity(undefined, "Вологда")).toBeNull();
  });
});
