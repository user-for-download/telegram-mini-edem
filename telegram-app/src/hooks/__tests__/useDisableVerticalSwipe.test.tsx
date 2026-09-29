// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (в telegram-app нет vitest setup-файла).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { mockDisable, mockEnable } = vi.hoisted(() => ({
  mockDisable: vi.fn(),
  mockEnable: vi.fn(),
}));

vi.mock("@tma.js/sdk-react", () => ({
  swipeBehavior: {
    disableVertical: { ifAvailable: mockDisable },
    enableVertical: { ifAvailable: mockEnable },
  },
}));

import { useDisableVerticalSwipe } from "@/hooks/useDisableVerticalSwipe";

function Host() {
  useDisableVerticalSwipe();
  return null;
}

describe("useDisableVerticalSwipe", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("на маунте отключает вертикальный свайп", () => {
    act(() => {
      root.render(<Host />);
    });
    expect(mockDisable).toHaveBeenCalledTimes(1);
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it("на размонтировании возвращает поведение клиента", () => {
    act(() => {
      root.render(<Host />);
    });
    act(() => {
      root.unmount();
    });
    expect(mockEnable).toHaveBeenCalledTimes(1);
  });
});
