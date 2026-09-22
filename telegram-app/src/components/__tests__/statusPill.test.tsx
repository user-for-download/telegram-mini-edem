// Тесты StatusPill без @testing-library/react (не установлен):
// react-dom/server renderToString — паттерн
// telegram-app/src/components/__tests__/lazyAvatar.test.tsx.
// Проверяется только обёртка (tone → data-tone, className, текст),
// внутренности CSS (StatusPill.module.css рядом с компонентом) не тестируем.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { StatusPill, type StatusTone } from "@/components/StatusPill/StatusPill";
import styles from "../StatusPill/StatusPill.module.css";

const TONES: StatusTone[] = ["warning", "danger", "info", "success"];

function render(tone: StatusTone, className?: string): string {
  return renderToString(
    <StatusPill tone={tone} className={className}>
      Статус
    </StatusPill>,
  );
}

describe("StatusPill", () => {
  it.each(TONES)("tone %s → data-tone=%s", (tone) => {
    const html = render(tone);
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain(styles.pill);
  });

  it("preserves text content (a11y: color + text, not color-only)", () => {
    expect(render("warning")).toContain("Статус");
  });

  it("merges extra className (e.g. shrink-0)", () => {
    const html = render("info", "shrink-0");
    expect(html).toContain(`${styles.pill} shrink-0`);
    expect(html).toContain('data-tone="info"');
  });

  it("renders without extra whitespace when className omitted", () => {
    const html = render("success");
    expect(html).toContain(`class="${styles.pill}"`);
  });
});
