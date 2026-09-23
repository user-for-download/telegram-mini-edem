// @vitest-environment jsdom
// Рендер-тесты ConfirmPopup: триггер с label, описание скрыто до клика
// (нативный popup вне SSR), пропсы один в один как у ConfirmAction.
// Фолбэк: вне Telegram popup.show.isAvailable() false — клик по триггеру
// переключает на инлайн ConfirmAction (регрессия: ifAvailable отдаёт
// кортеж [called, promise], await кортежа никогда не звал onConfirm).
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

// @vitest-environment jsdom — только для фолбэк-теста ниже (act + root).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import {
  isTelegramMockEnv,
  markTelegramMockEnv,
} from "@/utils/telegram-adapter";

function render(): string {
  return renderToString(
    <AppRoot platform="base">
      <ConfirmPopup
        label="Отменить"
        confirmLabel="Отменить поездку"
        description="Поездка станет недоступна."
        destructive
        onConfirm={() => {}}
      />
    </AppRoot>,
  );
}

describe("ConfirmPopup", () => {
  it("триггер с label, без инлайн-панели до клика", () => {
    const html = render();
    expect(html).toContain("Отменить");
    expect(html).not.toContain("Поездка станет недоступна.");
  });

  describe("фолбэк без Telegram", () => {
    let root: Root;
    let container: HTMLDivElement;

    beforeEach(() => {
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

    it("клик по триггеру показывает инлайн-подтверждение", async () => {
      await act(async () => {
        root.render(
          <AppRoot platform="base">
            <ConfirmPopup
              label="Отменить"
              confirmLabel="Отменить поездку"
              description="Поездка станет недоступна."
              destructive
              onConfirm={() => {}}
            />
          </AppRoot>,
        );
      });
      // Клик 1: нативного popup нет — откат на инлайн ConfirmAction.
      // Клик 2: armed — панель с описанием.
      for (let i = 0; i < 2; i += 1) {
        const trigger = container.querySelector("button");
        expect(trigger?.textContent).toContain("Отменить");
        await act(async () => {
          trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      }
      expect(container.innerHTML).toContain("Поездка станет недоступна.");
    });

    it("actionsEnd прижимает кнопки панели к правому краю", async () => {
      await act(async () => {
        root.render(
          <AppRoot platform="base">
            <ConfirmPopup
              label="Отменить"
              confirmLabel="Отменить поездку"
              description="Поездка станет недоступна."
              destructive
              actionsEnd
              onConfirm={() => {}}
            />
          </AppRoot>,
        );
      });
      // Клик 1: откат на инлайн. Клик 2: armed — панель.
      for (let i = 0; i < 2; i += 1) {
        const trigger = container.querySelector("button");
        await act(async () => {
          trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      }
      const buttons = [...container.querySelectorAll("button")];
      const confirm = buttons.find((b) =>
        b.textContent?.includes("Отменить поездку"),
      );
      // Панель — родитель кнопки подтверждения.
      expect(confirm?.parentElement?.className).toContain("items-end");
    });
  });

  describe("мок-окружение (dev-браузер)", () => {
    let root: Root;
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      markTelegramMockEnv();
      expect(isTelegramMockEnv()).toBe(true);
    });

    afterEach(() => {
      act(() => {
        root.unmount();
      });
      container.remove();
      delete (window as unknown as Record<string, unknown>)[
        "__TG_ENV_MOCKED__"
      ];
      expect(isTelegramMockEnv()).toBe(false);
    });

    it("действие сразу, без подтверждения: один клик — onConfirm", async () => {
      const onConfirm = vi.fn();
      await act(async () => {
        root.render(
          <AppRoot platform="base">
            <ConfirmPopup
              label="Отменить"
              confirmLabel="Отменить поездку"
              description="Поездка станет недоступна."
              destructive
              actionsEnd
              onConfirm={onConfirm}
            />
          </AppRoot>,
        );
      });
      // Браузер — dev-среда: никакой панели, один клик — действие.
      const trigger = container.querySelector("button");
      expect(trigger?.textContent).toContain("Отменить");
      await act(async () => {
        trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(container.innerHTML).not.toContain("Поездка станет недоступна.");
    });
  });
});
