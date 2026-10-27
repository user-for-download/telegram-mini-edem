// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useDeadlineClock } from "../useDeadlineClock";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime("2030-01-01T00:00:00Z"); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useDeadlineClock", () => {
  it.each([null, "not-a-date"])("не заводит таймер для %s", (deadline) => {
    renderHook(() => useDeadlineClock(deadline));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("длинный срок разбит на допустимые таймеры, cleanup снимает ожидание", () => {
    const deadline = "2030-04-01T00:00:00Z";
    const view = renderHook(() => useDeadlineClock(deadline));
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(2_147_483_647); });
    expect(view.result.current).toBe(Date.now());
    expect(view.result.current).toBeLessThan(Date.parse(deadline));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("возврат в окно обновляет время после фоновой паузы", () => {
    const view = renderHook(() => useDeadlineClock("2030-01-01T01:00:00Z"));
    vi.setSystemTime("2030-01-01T02:00:00Z");
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(view.result.current).toBe(Date.now());
    expect(vi.getTimerCount()).toBe(0);
  });
});
