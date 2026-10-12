// backend/tests/unit/domainEvents.test.ts
//
// Юнит-тесты шины без БД: подписка/отписка, доставка, изоляция ошибок.
// Контракт надёжности: emit() резолвится всегда и не реджектится никогда —
// иначе точка мутации, сделавшая await, уронила бы основной запрос.
import { describe, expect, it, vi } from "vitest";
import { DomainEmitter } from "../../src/events/domainEvents.js";

type TestEvents = {
  "user.pinged": { userId: string };
  "user.ponged": { n: number };
};

function freshEmitter() {
  return new DomainEmitter<TestEvents>("test");
}

describe("DomainEmitter", () => {
  it("доставляет payload подписанным слушателям", async () => {
    const ee = freshEmitter();
    const seen: Array<{ userId: string }> = [];
    ee.on("user.pinged", (payload) => {
      seen.push(payload);
    });

    await ee.emit("user.pinged", { userId: "u-1" });

    expect(seen).toEqual([{ userId: "u-1" }]);
  });

  it("не зовёт чужие события и пустой emit не падает", async () => {
    const ee = freshEmitter();
    const listener = vi.fn();
    ee.on("user.ponged", listener);

    await ee.emit("user.pinged", { userId: "u-1" });

    expect(listener).not.toHaveBeenCalled();
    // Событие вообще без слушателей — тоже тихо.
    const bare = freshEmitter();
    await expect(
      bare.emit("user.pinged", { userId: "u-1" }),
    ).resolves.toBeUndefined();
  });

  it("ошибка одного слушателя не мешает остальным и не реджектит emit", async () => {
    const ee = freshEmitter();
    const order: string[] = [];
    ee.on("user.pinged", () => {
      order.push("first");
      throw new Error("boom");
    });
    ee.on("user.pinged", async () => {
      order.push("second");
      throw new Error("async boom");
    });
    ee.on("user.pinged", () => {
      order.push("third");
    });

    await expect(
      ee.emit("user.pinged", { userId: "u-1" }),
    ).resolves.toBeUndefined();
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("off отписывает: возвращается unsub и работает прямой off", async () => {
    const ee = freshEmitter();
    const listener = vi.fn();
    const unsub = ee.on("user.pinged", listener);
    unsub();
    await ee.emit("user.pinged", { userId: "u-1" });
    expect(listener).not.toHaveBeenCalled();

    const second = vi.fn();
    ee.on("user.pinged", second);
    ee.off("user.pinged", second);
    await ee.emit("user.pinged", { userId: "u-1" });
    expect(second).not.toHaveBeenCalled();
    expect(ee.listenerCount("user.pinged")).toBe(0);
  });
});
