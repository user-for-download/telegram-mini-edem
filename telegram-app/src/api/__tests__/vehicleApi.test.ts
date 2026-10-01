import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  apiClient: { request: vi.fn() },
  ApiError: class ApiError extends Error {
    code?: string;
    status?: number;
    constructor(message: string, code?: string, status?: number) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  },
}));

import { ApiError, apiClient } from "@/api/client";
import { vehicleApi } from "@/api/vehicle";
import { userSchema } from "@edem/contracts";

const requestMock = vi.mocked(apiClient.request);

const validUser = {
  id: "user-1",
  name: "Водитель",
  avatar: "https://t.me/i/userpic/320/x.svg",
  rating: 5,
  reviewsCount: 0,
  tripsCount: 0,
  isVerified: false,
  notificationsEnabled: true,
  verifiedAt: null,
  onboardingVersion: null,
  car: { model: "Skoda Octavia", color: "белый", plate: "583" },
  about: undefined,
  createdAt: "2026-09-09T00:00:00.000Z",
};

const userWithoutCar = { ...validUser, car: undefined };

describe("vehicleApi: подресурс /users/me/car", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("upsertVehicle шлёт POST /users/me/car с JSON-телом и валидирует ответ", async () => {
    requestMock.mockResolvedValue(validUser);

    await vehicleApi.upsertVehicle({ model: "Lada", color: "белый" });

    expect(requestMock).toHaveBeenCalledWith(
      "/users/me/car",
      { method: "POST", body: JSON.stringify({ model: "Lada", color: "белый" }) },
      userSchema,
    );
  });

  it("upsertVehicle сохраняет авто без номера: контракт допускает отсутствие plate", async () => {
    const { car, ...rest } = validUser;
    void car;
    requestMock.mockResolvedValue({ ...rest, car: { model: "Lada", color: "белый" } });

    const user = await vehicleApi.upsertVehicle({ model: "Lada", color: "белый" });

    expect(user.car).toEqual({ model: "Lada", color: "белый" });
    expect(user.car).not.toHaveProperty("plate");
  });

  it("updateVehicle шлёт PATCH-алиас /users/me/car", async () => {
    requestMock.mockResolvedValue(validUser);

    await vehicleApi.updateVehicle({ model: "Lada", color: "белый", plate: "583" });

    expect(requestMock).toHaveBeenCalledWith(
      "/users/me/car",
      {
        method: "PATCH",
        body: JSON.stringify({ model: "Lada", color: "белый", plate: "583" }),
      },
      userSchema,
    );
  });

  it("невалидный ввод: серверный 400 пробрасывается вызывающему (форма показывает ошибку)", async () => {
    requestMock.mockRejectedValue(new ApiError("Invalid payload", undefined, 400));

    await expect(vehicleApi.upsertVehicle({ model: "", color: "белый" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("неавторизованный доступ: 401 пробрасывается (сессия/AuthGate обрабатывают)", async () => {
    requestMock.mockRejectedValue(new ApiError("Unauthorized", "UNAUTHORIZED", 401));

    await expect(
      vehicleApi.upsertVehicle({ model: "Lada", color: "белый" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("removeVehicle шлёт DELETE /users/me/car и валидирует ответ userSchema", async () => {
    requestMock.mockResolvedValue(userWithoutCar);

    const user = await vehicleApi.removeVehicle();

    expect(requestMock).toHaveBeenCalledWith("/users/me/car", { method: "DELETE" }, userSchema);
    expect(user.car).toBeUndefined();
  });

  it("removeVehicle: 409 при активных поездках пробрасывается (страница показывает объяснение)", async () => {
    requestMock.mockRejectedValue(
      new ApiError("Resolve active trips first", "ACCOUNT_HAS_ACTIVE_OBLIGATIONS", 409),
    );

    await expect(vehicleApi.removeVehicle()).rejects.toMatchObject({
      code: "ACCOUNT_HAS_ACTIVE_OBLIGATIONS",
      status: 409,
    });
  });

  it("removeVehicle: 404 без авто пробрасывается", async () => {
    requestMock.mockRejectedValue(new ApiError("Car not found", "NOT_FOUND", 404));

    await expect(vehicleApi.removeVehicle()).rejects.toMatchObject({ status: 404 });
  });
});
