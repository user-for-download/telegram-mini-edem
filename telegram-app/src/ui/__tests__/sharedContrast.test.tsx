// CSS pins protect token routing; a browser probe must validate color-mix
// numerically, because jsdom does not implement the layered kit cascade.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppRoot, Info } from "@telegram-apps/telegram-ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, type ButtonVariant } from "@/ui/Button";
import { Cell } from "@/ui/Cell";
import buttonStyles from "@/ui/Button.module.css";
import cellStyles from "@/ui/Cell.module.css";

const read = (relative: string): string => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)), "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const require = createRequire(import.meta.url);
const kitDir = dirname(require.resolve("@telegram-apps/telegram-ui/package.json"));
const kitCss = readFileSync(join(kitDir, "dist/styles.css"), "utf8");
const buttonCss = read("../Button.module.css");

describe("U01: shared action tones retain kit behavior and explicit overrides", () => {
  it.each<ButtonVariant>(["primary", "secondary", "gray", "ghost", "outline", "white"])(
    "%s delivers the contrast class and variant to the actual button",
    (variant) => {
      for (const platform of ["ios", "base"] as const) {
        const html = renderToString(
          <AppRoot platform={platform}>
            <Button variant={variant} className="consumer-danger" disabled loading>Action</Button>
          </AppRoot>,
        );
        expect(buttonStyles.button).toBeTruthy();
        expect(html).toMatch(new RegExp(`<button[^>]*class="[^"]*${buttonStyles.button}`));
        expect(html).toContain(`data-variant="${variant}"`);
        expect(html).toContain("consumer-danger");
        expect(html).toContain("disabled");
        expect(html).toContain("Action");
      }
    },
  );

  it("filled ink reaches text/icon/spinner slots without replacing semantic root ink", () => {
    expect(buttonCss).toMatch(/:where\(\.button\)\s*\{\s*color: var\(--app-info\)/);
    expect(buttonCss).toMatch(/:where\(\.button\[data-variant="primary"\]\)\s*\{\s*color: var\(--app-action-ink\)/);
    expect(buttonCss).toMatch(/\[data-variant="primary"\]\s*\{[^}]*background: var\(--app-action-surface\)/);
    expect(buttonCss).toMatch(/\[data-variant="primary"\] > \*\s*\{\s*color: var\(--app-action-label, var\(--app-action-text\)\)/);
    expect(buttonCss).toMatch(/\[data-variant="secondary"\]\s*\{\s*background: var\(--app-info-bg\)/);
    const tokens = read("../../index.css");
    expect(tokens).toMatch(/--app-action-surface:\s*color-mix\(in srgb, currentColor 80%, black\)/);
    expect(tokens).toMatch(/\.dark \.app-theme\s*\{\s*--app-action-ink:\s*var\(--tgui--button_color\);\s*--app-action-surface:\s*color-mix\(in srgb, currentColor 82%, black\)/);
    expect(tokens).toMatch(/--app-action-ink:\s*var\(--tgui--button_color\)/);
    expect(tokens).toMatch(/--app-action-label:\s*var\(--tgui--button_text_color\)/);
    expect(tokens).toMatch(/--app-action-text:\s*var\(--tgui--white\)/);
    expect(tokens).toMatch(/--app-badge-surface:\s*color-mix\(in srgb, currentColor 65%, black\)/);
    expect(buttonCss).not.toMatch(/#[\da-f]{3,8}\b|!important|:global/);
  });

  it("destructive fill keeps a white label on its own darker surface", () => {
    const css = read("../../components/ConfirmPopup.module.css");
    expect(css).toMatch(/\.destructive\s*\{[^}]*--app-action-label:\s*var\(--tgui--white\)/);
    expect(css).toMatch(/\.destructive\s*\{[^}]*--app-action-surface:\s*color-mix\(in srgb, var\(--app-danger\) 65%, black\)/);
  });
});

describe("U02: actual Cell and Placeholder text carriers read scoped muted ink", () => {
  it("Cell scopes the kit tokens rather than flattening status descendants", () => {
    const css = read("../Cell.module.css");
    for (const token of ["hint_color", "subtitle_text_color", "secondary_hint_color"]) {
      expect(css).toContain(`--tgui--${token}: var(--app-muted)`);
      expect(kitCss).toContain(`color:var(--tgui--${token})`);
    }
    expect(css).not.toMatch(/(^|[;{\s])color\s*:|>\s*\*|\.tgui-/);
    const html = renderToString(
      <AppRoot platform="base">
        <Cell
          subtitle={<span style={{ color: "var(--app-success)" }}>Confirmed</span>}
          description="Description"
          after={<Info type="text" subtitle="Date">Status</Info>}
        >Title</Cell>
      </AppRoot>,
    );
    expect(cellStyles.cell).toBeTruthy();
    expect(html).toContain(cellStyles.cell);
    expect(html).toContain("color:var(--app-success)");
    expect(html).toContain("Description");
    expect(html).toContain("Date");
    expect(read("../../components/Section/NextTripBanner.module.css"))
      .toContain("--tgui--subtitle_text_color: var(--app-muted)");
  });

  it("Placeholder description uses the scoped hint token, not a root color", () => {
    expect(read("../EmptyState.module.css")).toContain("--tgui--hint_color: var(--app-muted)");
    expect(kitCss).toMatch(/\.tgui-87cd6af55f73428d\{color:var\(--tgui--hint_color\)/);
  });
});

describe("U03: compact search without Field receives the shared placeholder tone", () => {
  it("all engine groups include FIELD_COMPACT without changing its geometry", () => {
    const css = read("../ui.module.css");
    for (const pseudo of ["::placeholder", "::-moz-placeholder", "::-webkit-input-placeholder"]) {
      const selector = `.fieldCompact input${pseudo}`;
      expect(css).toContain(`${selector} {\n  color: var(--app-muted);`);
    }
    expect(css).toMatch(/\.fieldCompact > div\s*\{\s*padding: 0;/);
    expect(read("../../pages/TripActive/TripActivePage.tsx")).toContain("FIELD_COMPACT");
  });
});

describe("U20: badge tones are checked against their own surfaces", () => {
  it("filled counters share action ink; zero counters use a theme-aware neutral surface", () => {
    const css = read("../../components/Section/TripCountersSection.module.css");
    expect(css).toMatch(/\.badge\s*\{[^}]*background: var\(--app-badge-surface\)/);
    expect(css).toMatch(/\.badge > \*\s*\{\s*color: var\(--app-action-text\)/);
    expect(css).toMatch(/\[data-tone="info"\]\s*\{\s*color: var\(--app-info\)/);
    expect(css).toMatch(/\[data-tone="danger"\]\s*\{\s*color: var\(--app-danger\)/);
    // Neutral badges are on the tinted InlineButtons surface, not a bare Page.
    expect(css).toMatch(/\[data-tone="zero"\]\s*\{\s*background: var\(--app-warning-bg\);\s*color: var\(--tgui--text_color\)/);
    expect(css).toMatch(/\[data-tone="zero"\] > \*\s*\{\s*color: inherit/);
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|!important|:global/);
    const tabbar = read("../../components/TabsBar/Tabbar.module.css");
    expect(tabbar).toMatch(/\.badge\s*\{[^}]*color: var\(--app-danger\);\s*background: var\(--app-badge-surface\)/);
    expect(tabbar).toMatch(/\.badge > \*\s*\{\s*color: var\(--app-action-text\)/);
  });
});
