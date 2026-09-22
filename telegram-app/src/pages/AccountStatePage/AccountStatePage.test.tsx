// Рендер-тесты терминальных экранов аккаунта: заголовок/описание,
// action-слот, RetryAction (label/disabled). Паттерн tripsPages.test.tsx
// (SSR renderToString, без testing-library).
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  AccountStatePage,
  RetryAction,
} from "@/pages/AccountStatePage/AccountStatePage";

function render(element: ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

describe("AccountStatePage", () => {
  it("показывает заголовок и описание, main с aria-live polite", () => {
    const html = render(
      <AccountStatePage title="Профиль удалён" description="Восстановление невозможно." />,
    );
    expect(html).toContain("Профиль удалён");
    expect(html).toContain("Восстановление невозможно.");
    expect(html).toContain('aria-live="polite"');
  });

  it("прокидывает action-слот (кнопка повтора)", () => {
    const html = render(
      <AccountStatePage
        title="Сессия завершилась"
        description="Подтвердите вход заново."
        action={
          <RetryAction label="Войти снова" onClick={() => {}} />
        }
      />,
    );
    expect(html).toContain("Сессия завершилась");
    expect(html).toContain("Войти снова");
  });
});

describe("RetryAction", () => {
  it("кнопка с label и onClick", () => {
    const onClick = vi.fn();
    const html = render(<RetryAction label="Попробовать снова" onClick={onClick} />);
    expect(html).toContain("Попробовать снова");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled прокидывается в кнопку", () => {
    const html = render(
      <RetryAction label="Войти снова" disabled onClick={() => {}} />,
    );
    expect(html).toContain("Войти снова");
    expect(html).toContain("disabled");
  });
});
