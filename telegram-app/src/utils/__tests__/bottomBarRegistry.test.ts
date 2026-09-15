import { describe, expect, it, vi } from "vitest";
import {
  getCurrent,
  register,
  subscribe,
  type BottomBarAction,
} from "@/utils/bottomBarRegistry";

const makeAction = (overrides?: Partial<BottomBarAction>): BottomBarAction => ({
  label: "Опубликовать",
  onSubmit: vi.fn(),
  loading: false,
  disabled: false,
  ...overrides,
});

describe("bottomBarRegistry (action нижнего бара)", () => {
  it("пустой реестр — null (обычные табы)", () => {
    expect(getCurrent()).toBeNull();
  });

  it("register активирует действие, unregister снимает (getCurrent → null)", () => {
    const first = makeAction();
    const release = register(first);
    expect(getCurrent()).toBe(first);
    release();
    expect(getCurrent()).toBeNull();
  });

  it("последняя регистрация побеждает, снятие возвращает предыдущую", () => {
    const first = makeAction({ label: "Первая" });
    const second = makeAction({ label: "Вторая" });
    const releaseFirst = register(first);
    const releaseSecond = register(second);
    expect(getCurrent()).toBe(second);
    releaseSecond();
    expect(getCurrent()).toBe(first);
    releaseFirst();
    expect(getCurrent()).toBeNull();
  });

  it("перерегистрация обновляет состояние (loading живой, не снапшот mount)", () => {
    const releaseIdle = register(makeAction({ loading: false }));
    releaseIdle();
    const releasePending = register(makeAction({ loading: true }));
    expect(getCurrent()?.loading).toBe(true);
    releasePending();
    expect(getCurrent()).toBeNull();
  });

  it("subscribe стреляет на register/unregister и молчит после отписки", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const release = register(makeAction());
    expect(listener).toHaveBeenCalledTimes(1);
    release();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    const transient = register(makeAction());
    transient();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("двойной unregister безопасен (no-op без лишних уведомлений)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const release = register(makeAction());
    release();
    release();
    expect(getCurrent()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("регистрация после снятия другого действия безопасна", () => {
    const first = makeAction({ label: "Первая" });
    const releaseFirst = register(first);
    const second = makeAction({ label: "Вторая" });
    const releaseSecond = register(second);
    releaseFirst();
    expect(getCurrent()).toBe(second);
    const third = makeAction({ label: "Третья" });
    const releaseThird = register(third);
    expect(getCurrent()).toBe(third);
    releaseThird();
    releaseSecond();
    expect(getCurrent()).toBeNull();
  });
});
