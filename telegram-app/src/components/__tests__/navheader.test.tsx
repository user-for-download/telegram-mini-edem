// Рендер-тесты sticky навбара: пусто без title, иначе видимая строка
// заголовка (aria-hidden — авторитетные h1 живут на страницах).
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { NavHeader } from "@/components/NavHeader/NavHeader";

describe("NavHeader", () => {
  it("пусто без title", () => {
    expect(renderToString(<NavHeader title={undefined} />)).toBe("");
  });

  it("видимая строка заголовка", () => {
    const html = renderToString(<NavHeader title="Поездки" />);
    expect(html).toContain("Поездки");
    expect(html).toContain('aria-hidden="true"');
  });
});
