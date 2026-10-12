// Сбой догрузки в ленте. `hasNextPage` после сбоя остаётся истинным, поэтому
// без явного текста кнопка «Показать ещё» выглядит как обычное «есть ещё»,
// и пользователь не понимает, что страница просто не загрузилась.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { FetchMore } from "@/ui/FetchMore";

function render(props: Partial<Parameters<typeof FetchMore>[0]> = {}): string {
  return renderToString(
    <AppRoot platform="base">
      <FetchMore
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        {...props}
      />
    </AppRoot>,
  );
}

describe("FetchMore", () => {
  it("обычное состояние: «Показать ещё» без тревожного текста", () => {
    const html = render();
    expect(html).toContain("Показать ещё");
    expect(html).not.toContain("Не удалось загрузить");
  });

  it("при сбое догрузки — внятный текст и повтор", () => {
    const html = render({ error: new Error("network") });
    expect(html).toContain("Не удалось загрузить ещё");
    expect(html).toContain("Повторить загрузку");
    // role=alert: автодогрузка без скролла о сбое не сообщила бы.
    expect(html).toContain('role="alert"');
  });

  it("без следующих страниц не рисуется ничего — даже при ошибке", () => {
    const html = render({ hasNextPage: false, error: new Error("network") });
    expect(html).not.toContain("Повторить загрузку");
    expect(html).not.toContain("Не удалось загрузить");
  });
});
