import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";

import {
  cityFormOnMutationError,
  EMPTY_CITY_FORM,
  type CityFormState,
} from "./mutationError";

// Регрессия F8: handleMutationError обнулял name во ВСЕХ ветках, включая
// 409 «город с таким именем уже есть» — самый частый исход, и именно
// ради него админу нужно подправить название, а не перепечатать его целиком.
// Решение вынесено в чистую функцию, потому что webapp-тесты работают в
// node-окружении без DOM, а CitiesPage нельзя импортировать без React.

const current: CityFormState = { name: "Новый город" };

describe("cityFormOnMutationError", () => {
  it("409 — сохраняет набранное имя и объясняет причину", () => {
    const error = new ApiError(409, "CONFLICT", "Город с таким именем уже существует");
    expect(cityFormOnMutationError(error, current)).toEqual({
      name: "Новый город",
      fieldError: "Город с таким именем уже существует",
    });
  });

  it("400 — сохраняет имя и показывает сообщение сервера", () => {
    const error = new ApiError(400, "VALIDATION_FAILED", "Название слишком длинное");
    expect(cityFormOnMutationError(error, current)).toEqual({
      name: "Новый город",
      fieldError: "Название слишком длинное",
    });
  });

  it("5xx — очищает форму: ввод уже не привязан к валидному состоянию", () => {
    const error = new ApiError(500, "INTERNAL_ERROR", "Внутренняя ошибка");
    expect(cityFormOnMutationError(error, current)).toEqual(EMPTY_CITY_FORM);
  });

  it("сетевой сбой без ApiError — тоже очищает", () => {
    expect(cityFormOnMutationError(new TypeError("Failed to fetch"), current)).toEqual(
      EMPTY_CITY_FORM,
    );
  });

  it("уже показанная ошибка поля не накапливается", () => {
    const withError: CityFormState = { name: "Ещё город", fieldError: "старое" };
    const error = new ApiError(409, "CONFLICT", "x");
    expect(cityFormOnMutationError(error, withError).fieldError).not.toBe("старое");
  });
});