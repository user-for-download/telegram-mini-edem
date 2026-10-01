import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  apiClient: { request: vi.fn() },
}));

import { apiClient } from "@/api/client";
import { profileApi } from "@/api/profile";
import { userSchema } from "@edem/contracts";

const requestMock = vi.mocked(apiClient.request);

const validUser = {
  id: "user-1",
  name: "Тест",
  avatar: "https://t.me/i/userpic/320/x.svg",
  rating: 5,
  reviewsCount: 0,
  tripsCount: 0,
  isVerified: true,
  notificationsEnabled: true,
  verifiedAt: null,
  onboardingVersion: null,
  car: undefined,
  about: undefined,
  createdAt: "2026-09-09T00:00:00.000Z",
};

describe("profileApi (Telegram)", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("getCurrentUser идёт на /users/me с userSchema-валидацией", async () => {
    const signal = new AbortController().signal;
    requestMock.mockResolvedValue(validUser);

    await profileApi.getCurrentUser(signal);

    expect(requestMock).toHaveBeenCalledWith("/users/me", { signal }, userSchema);
  });

  it("updateProfile шлёт PATCH с JSON-телом и валидирует ответ", async () => {
    requestMock.mockResolvedValue(validUser);

    await profileApi.updateProfile({ name: "Новое", about: "О себе" });

    expect(requestMock).toHaveBeenCalledWith(
      "/users/me",
      { method: "PATCH", body: JSON.stringify({ name: "Новое", about: "О себе" }) },
      userSchema,
    );
  });

  it("updateNotificationSettings шлёт флаг notificationsEnabled", async () => {
    requestMock.mockResolvedValue(validUser);

    await profileApi.updateNotificationSettings(false);

    expect(requestMock).toHaveBeenCalledWith(
      "/users/me/notification-settings",
      { method: "PATCH", body: JSON.stringify({ notificationsEnabled: false }) },
      userSchema,
    );
  });

  it("deleteAccount идёт на DELETE /users/me", async () => {
    requestMock.mockResolvedValue({ success: true });

    await profileApi.deleteAccount();

    expect(requestMock).toHaveBeenCalledWith(
      "/users/me",
      { method: "DELETE" },
      expect.anything(),
    );
  });
});
