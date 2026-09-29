import { describe, expect, it, vi } from "vitest";

vi.mock("@tma.js/sdk-react", () => ({
  hapticFeedback: {
    impactOccurred: { ifAvailable: vi.fn() },
    selectionChanged: { ifAvailable: vi.fn() },
    notificationOccurred: { ifAvailable: vi.fn() },
  },
}));

import { hapticFeedback } from "@tma.js/sdk-react";
import { haptic } from "@/utils/haptics";

const impact = vi.mocked(hapticFeedback.impactOccurred.ifAvailable);
const selection = vi.mocked(hapticFeedback.selectionChanged.ifAvailable);
const notification = vi.mocked(hapticFeedback.notificationOccurred.ifAvailable);

describe("haptic (граница sdk-react)", () => {
  it("маппит уровни на impactOccurred", () => {
    haptic.light();
    haptic.medium();
    haptic.heavy();
    expect(impact).toHaveBeenNthCalledWith(1, "light");
    expect(impact).toHaveBeenNthCalledWith(2, "medium");
    expect(impact).toHaveBeenNthCalledWith(3, "heavy");
  });

  it("selection/success/warning/error — свои методы", () => {
    haptic.selection();
    haptic.success();
    haptic.warning();
    haptic.error();
    expect(selection).toHaveBeenCalledTimes(1);
    expect(notification).toHaveBeenNthCalledWith(1, "success");
    expect(notification).toHaveBeenNthCalledWith(2, "warning");
    expect(notification).toHaveBeenNthCalledWith(3, "error");
  });
});
