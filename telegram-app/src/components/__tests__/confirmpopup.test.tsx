// @vitest-environment jsdom
// Рендер-тесты ConfirmPopup.
//
// Ключевое разделение веток — по наличию нативного алерта Telegram:
//
//   Telegram, popup доступен  → popup.show() — нативный диалог клиента
//   браузер (dev-стенд)        → ConfirmSheet (popup.show.isAvailable() === false)
//   Telegram для macOS (mock)  → ConfirmSheet (SDK врёт isAvailable() === true)
//
// Последняя ветка — регресс на безопасность: мок-окружение раньше
// выполняло деструктивное действие СРАЗУ, без подтверждения, то есть
// «Удалить профиль» на macOS удалял аккаунт одним тапом.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { handleModalBack } from "@/utils/modalBack";
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

/** Клик по триггеру. Возвращает текст, который появился на экране. */
async function clickTrigger(root: Root, container: HTMLElement) {
  const trigger = container.querySelector("button");
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return document.body.textContent ?? "";
}

describe("ConfirmPopup", () => {
  it("триггер с label, без описания до подтверждения", () => {
    const html = render();
    expect(html).toContain("Отменить");
    expect(html).not.toContain("Поездка станет недоступна.");
  });

  describe("фолбэк без Telegram (браузер)", () => {
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

    function mount(onConfirm = () => {}) {
      return act(async () => {
        root.render(
          <AppRoot platform="base">
            <ConfirmPopup
              label="Отменить"
              confirmLabel="Отменить поездку"
              description="Поездка станет недоступна."
              destructive
              onConfirm={onConfirm}
            />
          </AppRoot>,
        );
      });
    }

    it("один клик открывает шторку с описанием", async () => {
      // popup.show.isAvailable() вне Telegram === false, поэтому НАТИВНЫЙ
      // алерт не показывается — открывается наша шторка.
      await mount();
      const text = await clickTrigger(root, container);
      expect(text).toContain("Поездка станет недоступна.");
      expect(text).toContain("Отмена");
    });

    it("подтверждение в шторке выполняет действие", async () => {
      const onConfirm = vi.fn();
      await mount(onConfirm);
      await clickTrigger(root, container);

      const confirm = [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Отменить поездку"),
      );
      expect(confirm).toBeTruthy();
      await act(async () => {
        confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("отмена в шторке НЕ выполняет действие", async () => {
      const onConfirm = vi.fn();
      await mount(onConfirm);
      await clickTrigger(root, container);

      const cancel = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Отмена",
      );
      expect(cancel).toBeTruthy();
      await act(async () => {
        cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(onConfirm).not.toHaveBeenCalled();
    });

    describe("нативный Back при открытой шторке", () => {
      it("закрытая шторка не перехватывает Back", async () => {
        await mount();
        // Back должен увести по истории, а не закрывать несуществующее окно.
        expect(handleModalBack()).toBe(false);
      });

      it("открытая шторка перехватывает Back и закрывается без действия", async () => {
        const onConfirm = vi.fn();
        await mount(onConfirm);
        await clickTrigger(root, container);
        expect(document.body.textContent).toContain(
          "Поездка станет недоступна.",
        );

        // Без useModalBack внутри ConfirmSheet Back ушёл бы со страницы
        // вместо закрытия шторки. Обработка внутри act: onClose снимает
        // подписку в cleanup эффекта, и без act ре-рендер не прошёл бы —
        // проверяли бы React-тайминг, а не поведение шторки.
        let intercepted = false;
        await act(async () => {
          intercepted = handleModalBack();
        });
        expect(intercepted).toBe(true);
        // Шторка закрылась, действие НЕ выполнено, Back свободен экрану.
        expect(onConfirm).not.toHaveBeenCalled();
        expect(handleModalBack()).toBe(false);
      });
    });
  });

  describe("мок-окружение (Telegram для macOS)", () => {
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
      delete (window as unknown as Record<string, unknown>)["__TG_ENV_MOCKED__"];
      expect(isTelegramMockEnv()).toBe(false);
    });

    it("ТРЕБУЕТ подтверждения, а не выполняет действие сразу", async () => {
      // Регресс безопасности: раньше мок-ветка звала onConfirm() прямо из
      // триггера. На macOS «Удалить профиль» проходило без вопроса.
      const onConfirm = vi.fn();
      await act(async () => {
        root.render(
          <AppRoot platform="base">
            <ConfirmPopup
              label="Удалить профиль"
              confirmLabel="Да, удалить профиль"
              description="Аккаунт будет анонимизирован."
              destructive
              onConfirm={onConfirm}
            />
          </AppRoot>,
        );
      });

      const text = await clickTrigger(root, container);

      // Никакого действия — показано подтверждение.
      expect(onConfirm).not.toHaveBeenCalled();
      expect(text).toContain("Аккаунт будет анонимизирован.");
      expect(text).toContain("Да, удалить профиль");
    });
  });
});
