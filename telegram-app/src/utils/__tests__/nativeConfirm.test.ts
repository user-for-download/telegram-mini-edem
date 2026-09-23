// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockShow, mockIsAvailable } = vi.hoisted(() => ({
  mockShow: vi.fn(),
  mockIsAvailable: vi.fn(),
}));

// Мокаем SDK целиком: popup.show — управляемый мок,
// isTelegramMockEnv — через window-флаг (markTelegramMockEnv).
vi.mock("@telegram-apps/sdk-react", () => ({
  miniApp: { ready: { ifAvailable: vi.fn() } },
  openTelegramLink: { ifAvailable: vi.fn(), isAvailable: () => true },
  popup: { show: Object.assign(mockShow, { isAvailable: mockIsAvailable }) },
  retrieveRawInitData: vi.fn(),
  shareURL: { ifAvailable: vi.fn(), isAvailable: () => true },
}));

import { popup } from "@telegram-apps/sdk-react";
import {
  isTelegramMockEnv,
  markTelegramMockEnv,
  nativeConfirm,
} from "@/utils/telegram-adapter";

const mockedIsAvailable = vi.mocked(popup.show.isAvailable);
const mockedShow = vi.mocked(popup.show);

const OPTS = {
  title: "Подтвердить пассажира?",
  message: "Пётр · место №1",
  confirmText: "Подтвердить",
};

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>)["__TG_ENV_MOCKED__"];
});

describe("nativeConfirm", () => {
  it("мок-окружение (dev-браузер): true сразу, без вызова popup", async () => {
    markTelegramMockEnv();
    expect(isTelegramMockEnv()).toBe(true);

    await expect(nativeConfirm(OPTS)).resolves.toBe(true);
    expect(mockedIsAvailable).not.toHaveBeenCalled();
    expect(mockedShow).not.toHaveBeenCalled();
  });

  it("popup недоступен (старый клиент): false, show не зовём", async () => {
    mockedIsAvailable.mockReturnValue(false);

    await expect(nativeConfirm(OPTS)).resolves.toBe(false);
    expect(mockedShow).not.toHaveBeenCalled();
  });

  it("кнопка confirm → true, закрытие/null → false", async () => {
    mockedIsAvailable.mockReturnValue(true);
    mockedShow.mockResolvedValueOnce("confirm");
    await expect(nativeConfirm(OPTS)).resolves.toBe(true);

    mockedShow.mockResolvedValueOnce(null);
    await expect(nativeConfirm(OPTS)).resolves.toBe(false);

    mockedShow.mockResolvedValueOnce("cancel");
    await expect(nativeConfirm(OPTS)).resolves.toBe(false);
  });

  it("destructive пробрасывает тип кнопки, ошибка SDK → false", async () => {
    mockedIsAvailable.mockReturnValue(true);
    mockedShow.mockResolvedValue("confirm");

    await nativeConfirm({ ...OPTS, destructive: true });
    expect(mockedShow).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: [
          { id: "cancel", type: "cancel" },
          { id: "confirm", type: "destructive", text: "Подтвердить" },
        ],
      }),
    );

    mockedShow.mockRejectedValueOnce(new Error("bridge down"));
    await expect(nativeConfirm(OPTS)).resolves.toBe(false);
  });
});
