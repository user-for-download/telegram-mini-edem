import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { TripCell } from "@/components/TripCell";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<AppRoot>{node}</AppRoot>);
}

describe("TripCell", () => {
  it("рендерит шаблон: аватар, маршрут, имя, мета", () => {
    const html = render(
      <TripCell
        avatar={{ name: "Анна", rating: 4.5 }}
        title="Москва → Казань"
        subtitle="Анна"
        description="500₽ · место 2 · 20 сен · 08:00"
      />,
    );
    expect(html).toContain("Москва → Казань");
    expect(html).toContain("Анна");
    expect(html).toContain("4.5");
  });

  it("без рейтинга — без бейджа, без onOpen — статичная", () => {
    const onOpen = vi.fn();
    const html = render(
      <TripCell avatar={{ name: "Бо" }} title="A → B" />,
    );
    expect(html).not.toContain("Avatar__badge");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
