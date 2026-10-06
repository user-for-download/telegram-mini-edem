// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { ToastProvider, useToast } from "@/components/Toast/ToastProvider";

/**
 * Роль и aria-live живут на самом Snackbar, а не на обёртке вокруг него:
 * AppRoot рендерит Snackbar через портал, и роль на обёртке висела бы
 * на пустом узле — тост скринридеру не объявлялся бы вовсе.
 *
 * Рендер в jsdom, а не renderToString: важно проверить, что роль стоит
 * на узле с ТЕКСТОМ, а не рядом с ним.
 */

function Harness({ assertive }: { assertive?: boolean }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast.show({ text: "Профиль обновлён", assertive })}
    >
      показать
    </button>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(assertive?: boolean) {
  act(() => {
    root.render(
      <AppRoot platform="base">
        <ToastProvider>
          <Harness assertive={assertive} />
        </ToastProvider>
      </AppRoot>,
    );
  });
}

const liveNodes = () =>
  [...container.querySelectorAll('[role="status"], [role="alert"]')];

describe("ToastProvider: роль на самом тосте", () => {
  it("вежливый тост: role=status + aria-live=polite на узле с текстом", () => {
    render();
    act(() => {
      container.querySelector("button")?.click();
    });

    const nodes = liveNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.getAttribute("role")).toBe("status");
    expect(nodes[0]?.getAttribute("aria-live")).toBe("polite");
    // Роль на узле с текстом, а не на пустом соседе (суть бага).
    expect(nodes[0]?.textContent).toContain("Профиль обновлён");
    expect(nodes[0]?.children.length).toBeGreaterThan(0);
  });

  it("assertive-ветка: role=alert + aria-live=assertive", () => {
    render(true);
    act(() => {
      container.querySelector("button")?.click();
    });

    const nodes = liveNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.getAttribute("role")).toBe("alert");
    expect(nodes[0]?.getAttribute("aria-live")).toBe("assertive");
    expect(nodes[0]?.textContent).toContain("Профиль обновлён");
  });

  it("тост скрывается сам по duration", () => {
    render();
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(liveNodes()).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(liveNodes()).toHaveLength(0);
  });
});
