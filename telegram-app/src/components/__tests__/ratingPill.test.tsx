import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RatingPill } from "@/components/RatingPill";

function render(value: number | null, size?: "m" | "s"): string {
  return renderToStaticMarkup(<RatingPill value={value} size={size} />);
}

describe("RatingPill", () => {
  it("формат через точку: 4.9", () => {
    const html = render(4.9);
    expect(html).toContain("4.9");
    expect(html).not.toContain("4,9");
  });

  it("null — прочерк", () => {
    const html = render(null);
    expect(html).toContain("—");
  });

  it("кламп диапазона 0…5", () => {
    expect(render(9)).toContain("5.0");
    expect(render(-2)).toContain("0.0");
  });
});
