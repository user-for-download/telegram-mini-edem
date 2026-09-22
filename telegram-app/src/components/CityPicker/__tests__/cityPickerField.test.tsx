import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  CityPickerField,
  cityNameFromPicked,
  selectedCityOptions,
  toCityOptions,
} from "@/components/CityPicker/CityPickerField";

const CITIES = [
  { id: "1", name: "Вологда" },
  { id: "2", name: "Череповец" },
  { id: "3", name: "Великий Устюг" },
  { id: "4", name: "Волоколамск" },
];

describe("toCityOptions", () => {
  it("маппит справочник в value=id/label=name", () => {
    expect(toCityOptions(CITIES)).toEqual([
      { value: "1", label: "Вологда" },
      { value: "2", label: "Череповец" },
      { value: "3", label: "Великий Устюг" },
      { value: "4", label: "Волоколамск" },
    ]);
  });

  it("без справочника — пусто", () => {
    expect(toCityOptions(undefined)).toEqual([]);
  });
});

describe("selectedCityOptions", () => {
  it("max = 1: имя → одна опция", () => {
    expect(selectedCityOptions(CITIES, "Вологда")).toEqual([
      { value: "1", label: "Вологда" },
    ]);
  });

  it("имя вне справочника — пусто", () => {
    expect(selectedCityOptions(CITIES, "Москва")).toEqual([]);
    expect(selectedCityOptions(undefined, "Вологда")).toEqual([]);
  });
});

describe("cityNameFromPicked", () => {
  it("берёт последний (повторный выбор заменяет текущий)", () => {
    expect(
      cityNameFromPicked(CITIES, [
        { value: "1", label: "Вологда" },
        { value: "2", label: "Череповец" },
      ]),
    ).toBe("Череповец");
  });

  it("пусто (снятие чипа) → ''", () => {
    expect(cityNameFromPicked(CITIES, [])).toBe("");
  });

  it("id вне справочника → ''", () => {
    expect(cityNameFromPicked(CITIES, [{ value: "9", label: "?" }])).toBe("");
  });
});

describe("CityPickerField SSR", () => {
  function render(value: string): string {
    return renderToString(
      <AppRoot platform="base">
        <CityPickerField
          id="create-from"
          label="Город отправления"
          value={value}
          cities={CITIES}
          placeholder="Откуда едем"
          onSelect={() => {}}
        />
      </AppRoot>,
    );
  }

  it("инпут связан с label через id (a11y + e2e getByLabel)", () => {
    const html = render("");
    expect(html).toContain('for="create-from"');
    expect(html).toContain('id="create-from"');
  });

  it("выбранный город виден чипом", () => {
    expect(render("Вологда")).toContain("Вологда");
  });
});
