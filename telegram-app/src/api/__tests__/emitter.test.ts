import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniEmitter } from "@/api/emitter";

type TestEvents = {
  data: [value: string];
  empty: [];
  counted: [n: number];
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MiniEmitter", () => {
  it("вызывает подписчиков с аргументами события", () => {
    const emitter = new MiniEmitter<TestEvents>("test");
    const listener = vi.fn();
    emitter.on("data", listener);

    emitter.emit("data", "hello");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("hello");
  });

  it("отписка через off прекращает вызовы", () => {
    const emitter = new MiniEmitter<TestEvents>("test");
    const listener = vi.fn();
    emitter.on("data", listener);
    emitter.off("data", listener);

    emitter.emit("data", "hello");

    expect(listener).not.toHaveBeenCalled();
  });

  it("возвращённая из on функция отписывает слушателя", () => {
    const emitter = new MiniEmitter<TestEvents>("test");
    const listener = vi.fn();
    const unsubscribe = emitter.on("data", listener);
    unsubscribe();

    emitter.emit("data", "hello");

    expect(listener).not.toHaveBeenCalled();
  });

  it("изолирует упавшего слушателя: остальные вызываются, ошибка в console.error", () => {
    const emitter = new MiniEmitter<TestEvents>("test");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    const failing = vi.fn(() => {
      throw boom;
    });
    const next = vi.fn();
    emitter.on("data", failing);
    emitter.on("data", next);

    expect(() => emitter.emit("data", "hello")).not.toThrow();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith("hello");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[test] data listener error:", boom);
  });

  it("не смешивает события между собой", () => {
    const emitter = new MiniEmitter<TestEvents>("test");
    const onData = vi.fn();
    const onCounted = vi.fn();
    emitter.on("data", onData);
    emitter.on("counted", onCounted);

    emitter.emit("counted", 42);

    expect(onCounted).toHaveBeenCalledWith(42);
    expect(onData).not.toHaveBeenCalled();
  });

  it("emit без подписчиков — no-op", () => {
    const emitter = new MiniEmitter<TestEvents>("test");

    expect(() => emitter.emit("empty")).not.toThrow();
  });
});
