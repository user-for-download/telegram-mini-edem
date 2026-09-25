// CSS-контракт каркаса (сессия tailwind-decommission): проверяем сырой текст
// stylesheet'ов, потому что SSR-тесты разметки не видят каскад. Регрессия,
// которую ловим: TGUI вне слоя `tgui` + статичный низ Page → на iOS
// `padding: 10px 18px` от List перебивает клиренс дока и контент уходит
// под таббар (нижняя кнопка «Создать поездку»).
// Паттерн чтения модуля — ui/__tests__/notice.test.tsx (readFileSync).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readCss = (relativePath: string): string =>
  readFileSync(join(here, relativePath), "utf8");

const indexCss = readCss("../index.css");
const pageCss = readCss("../ui/ui.module.css");
const tabbarCss = readCss("../components/TabsBar/Tabbar.module.css");

describe("каркас: слой TGUI и нижний клиренс", () => {
  it("TGUI подключён в @layer tgui (неслойные модули должны побеждать)", () => {
    expect(indexCss).toContain("@layer tgui;");
    expect(indexCss).toContain(
      '@import "@telegram-apps/telegram-ui/dist/styles.css" layer(tgui);',
    );
  });

  it("Page берёт низ из токена, а не из литерала", () => {
    expect(pageCss).toMatch(/\.page\s*\{[\s\S]*?var\(--app-page-pad-bottom\)/);
  });

  it("клиренс Page включает высоту дока, отрыв пилюли и нижнюю safe-area", () => {
    expect(indexCss).toContain("--app-safe-bottom:");
    expect(indexCss).toContain("--app-dock-height: 64px;");
    expect(indexCss).toContain("--app-dock-gap: 8px;");
    expect(indexCss).toContain("--app-dock-float: 12px;");
    expect(indexCss).toContain("--app-page-pad-bottom: calc(");
  });

  it("нативный таббар: позиционированием и safe-area владеет кит (свой док удалён)", () => {
    expect(tabbarCss).toContain("FixedLayout");
    expect(tabbarCss).not.toContain(".dock");
    expect(tabbarCss).not.toContain("position: fixed");
  });

  it("Tailwind не возвращается в telegram-app", () => {
    expect(indexCss).not.toContain('@import "tailwindcss"');
    expect(indexCss).not.toContain("@tailwindcss");
  });
});
