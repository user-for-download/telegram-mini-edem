import { describe, expect, it } from "vitest";
import {
  normalizeVehicleForm,
  validateVehicleForm,
  vehicleRemoveErrorMessage,
  vehicleServerErrorMessage,
} from "@/components/Profile/vehicleValidation";
import { VEHICLE_KEYS } from "@/queries/vehicle";
import { PROFILE_KEYS } from "@/queries/profile";
import { USER_KEYS } from "@/queries/useUsersQuery";
import { ApiError } from "@/api/client";

describe("validateVehicleForm (порт CarFormModal)", () => {
  it("принимает корректные данные с номером и без", () => {
    expect(validateVehicleForm("Skoda Octavia", "белый", "583")).toBeNull();
    expect(validateVehicleForm("Skoda Octavia", "белый", "")).toBeNull();
  });

  it("отклоняет пустые модель и цвет (включая пробельные)", () => {
    expect(validateVehicleForm("", "белый", "")).toBe("Укажите модель автомобиля");
    expect(validateVehicleForm("   ", "белый", "")).toBe("Укажите модель автомобиля");
    expect(validateVehicleForm("Lada", "", "")).toBe("Укажите цвет автомобиля");
    expect(validateVehicleForm("Lada", "   ", "")).toBe("Укажите цвет автомобиля");
  });

  it("отклоняет поля длиннее backend-лимитов (model 50, color 30, plate 15)", () => {
    expect(validateVehicleForm("м".repeat(51), "белый", "")).toBe(
      "Модель не может быть длиннее 50 символов",
    );
    expect(validateVehicleForm("Lada", "ц".repeat(31), "")).toBe(
      "Цвет не может быть длиннее 30 символов",
    );
    expect(validateVehicleForm("Lada", "белый", "x".repeat(16))).toBe(
      "Номер не может быть длиннее 15 символов",
    );
  });

  it("принимает граничные длины (50/30/15)", () => {
    expect(validateVehicleForm("м".repeat(50), "ц".repeat(30), "x".repeat(15))).toBeNull();
  });
});

describe("normalizeVehicleForm (порт CarFormModal)", () => {
  it("тримит модель и цвет", () => {
    expect(normalizeVehicleForm("  Lada  ", "  белый  ", "")).toEqual({
      model: "Lada",
      color: "белый",
    });
  });

  it("номер приводит к верхнему регистру", () => {
    expect(normalizeVehicleForm("Lada", "белый", "а123бв")).toEqual({
      model: "Lada",
      color: "белый",
      plate: "А123БВ",
    });
  });

  it("пустой/пробельный номер не отправляет — backend стирает plate (remove-путь)", () => {
    expect(normalizeVehicleForm("Lada", "белый", "   ")).toEqual({
      model: "Lada",
      color: "белый",
    });
    expect(normalizeVehicleForm("Lada", "белый", "   ")).not.toHaveProperty("plate");
  });
});

describe("vehicleServerErrorMessage", () => {
  it("маппит auth/rate-limit/validation состояния backend", () => {
    expect(vehicleServerErrorMessage(new ApiError("Unauthorized", "UNAUTHORIZED", 401))).toBe(
      "Сессия истекла. Войдите заново и повторите.",
    );
    expect(vehicleServerErrorMessage(new ApiError("Slow down", "RATE_LIMITED", 429))).toBe(
      "Слишком много попыток. Подождите и повторите позже.",
    );
    expect(vehicleServerErrorMessage(new ApiError("Invalid payload", undefined, 400))).toBe(
      "Проверьте данные формы и повторите.",
    );
    expect(
      vehicleServerErrorMessage(new ApiError("Invalid server response", "INVALID_RESPONSE", 502)),
    ).toBe("Сервер вернул некорректный ответ. Повторите позже.");
  });

  it("прочие ошибки показывает текстом, не-Error — fallback", () => {
    expect(vehicleServerErrorMessage(new ApiError("Boom", undefined, 500))).toBe("Boom");
    expect(vehicleServerErrorMessage(new Error("сеть"))).toBe("сеть");
    expect(vehicleServerErrorMessage(null)).toBe("Не удалось сохранить автомобиль");
  });
});

describe("vehicleRemoveErrorMessage (DELETE /users/me/car)", () => {
  it("409 — объяснение про активные поездки, а не общая ошибка", () => {
    expect(
      vehicleRemoveErrorMessage(
        new ApiError("Resolve active trips first", "ACCOUNT_HAS_ACTIVE_OBLIGATIONS", 409),
      ),
    ).toBe("Нельзя удалить автомобиль: завершите или отмените активные поездки.");
  });

  it("404 — авто уже удалено", () => {
    expect(vehicleRemoveErrorMessage(new ApiError("Car not found", "NOT_FOUND", 404))).toBe(
      "Автомобиль уже удалён.",
    );
  });

  it("остальное — общий маппинг и fallback", () => {
    expect(vehicleRemoveErrorMessage(new ApiError("Unauthorized", "UNAUTHORIZED", 401))).toBe(
      "Сессия истекла. Войдите заново и повторите.",
    );
    expect(vehicleRemoveErrorMessage(new Error("сеть"))).toBe("сеть");
    expect(vehicleRemoveErrorMessage(null)).toBe("Не удалось удалить автомобиль");
  });
});

describe("VEHICLE_KEYS (кэш без рассинхрона)", () => {
  it("совпадает с PROFILE_KEYS/USER_KEYS — мутации пишут одну запись", () => {
    expect(VEHICLE_KEYS.current()).toEqual(["users", "me"]);
    expect(VEHICLE_KEYS.current()).toEqual(PROFILE_KEYS.current());
    expect(VEHICLE_KEYS.current()).toEqual(USER_KEYS.current());
  });
});
