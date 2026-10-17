// ui/GroupLabel — общий заголовок группы (шторки/карточки).
//
// SSR-паттерн как у ui/__tests__/section.test.tsx: renderToString, потому
// что китовые компоненты и AppRoot не требуют DOM. Тон и кегль держит
// CSS-модуль (пин — ui/__tests__/consistency.test.ts), здесь проверяем
// ФАКТ доставки класса и уровня типографики: без класса правило мёртвое
// (прецедент ui/Card и cssClassReach.test.ts).
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { GroupLabel } from "@/ui/GroupLabel";
import styles from "@/ui/GroupLabel.module.css";

function render(element: React.ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

describe("GroupLabel", () => {
  it("рендерит p по умолчанию и несёт свой класс", () => {
    const html = render(<GroupLabel>Ожидают решения (3)</GroupLabel>);
    expect(html).toContain(styles.label);
    expect(html).toContain("<p");
    expect(html).toContain("Ожидают решения (3)");
  });

  it("Component меняет тег, класс остаётся", () => {
    const html = render(<GroupLabel Component="span">В поездке (1)</GroupLabel>);
    expect(html).toContain("<span");
    expect(html).toContain(styles.label);
  });

  it("доп. className склеивается с классовым рецептом", () => {
    const html = render(<GroupLabel className="extra">Группа</GroupLabel>);
    expect(html).toContain(styles.label);
    expect(html).toContain("extra");
  });

  it("вес 2 (600) — заголовок группы не спорит с заголовком экрана", () => {
    const html = render(<GroupLabel>Группа</GroupLabel>);
    // Кит вешает класс веса accent2 (600); значение пинится на уровне
    // ui/GroupLabel.module.css, здесь — что weight вообще передан киту.
    expect(html).toContain("tgui-");
    expect(html).toContain("Группа");
  });
});
