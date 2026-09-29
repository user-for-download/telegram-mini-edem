// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Флаг тестового окружения React 19: без него act() вне раннера считается
// вне тестового окружения (паттерн hooks/__tests__ и __tests__/AppConfig).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Ready-order guard (tma-sdk-04).
 *
 * Инвариант запуска: `init → render(<App/>) → effect(signalAppReady)`.
 * Скелетон Telegram должен гаснуть только после первой отрисовки:
 * `signalAppReady()` живёт в `useEffect` App (после маунта), а НЕ рядом
 * с `await init()` в main.tsx. Тест ловит регрессию «ready до рендера»:
 * до render вызова нет, после первого paint — ровно один.
 */

// Тяжёлое дерево App здесь не нужно: проверяем порядок ready,
// а не вёрстку — AppConfig/AppRouter заменяем заглушками.
vi.mock("@/AppConfig", () => ({
  AppConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/router/AppRouter", () => ({
  AppRouter: () => <div data-testid="router-stub" />,
}));

// signalAppReady мокаем, остальной адаптер — настоящий.
vi.mock("@/utils/telegram-adapter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/utils/telegram-adapter")>();
  return { ...actual, signalAppReady: vi.fn() };
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "@/App";
import { signalAppReady } from "@/utils/telegram-adapter";

const mockedReady = vi.mocked(signalAppReady);

describe("ready-order: signalAppReady после первой отрисовки", () => {
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

  it("до render вызова нет, после mount — ровно один", () => {
    // До первой отрисовки ready слать нельзя (скелетон Telegram
    // погаснет поверх пустого WebView).
    expect(mockedReady).not.toHaveBeenCalled();

    act(() => {
      root.render(<App />);
    });

    expect(mockedReady).toHaveBeenCalledTimes(1);
  });
});
