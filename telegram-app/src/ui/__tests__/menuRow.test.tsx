// Пин ui/MenuRow — общей строки меню.
//
// Проверяем и разметку, и УШИРИНУ: `width: 100%` — единственное, что
// держит строку в границах карточки. Без него кнопка `Cell` живёт по размеру
// контента (min-content), и длинная подпись растягивала строку за рамку секции:
// на 390-экране 553px при секции 356px, шеврон уезжал за карточку. Это видедно
// только в браузере, поэтому здесь читаем CSS-файл самого компонента — свой,
// не класс-хеш кита (хеш меняется при bump версии).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MenuRow } from "@/ui/MenuRow";

const css = readFileSync(
  fileURLToPath(new URL("../MenuRow.module.css", import.meta.url)),
  "utf8",
);

function renderRow() {
  return renderToString(
    <AppRoot platform="base">
      <MenuRow
        icon={<span>i</span>}
        title="История запросов"
        subtitle="Мои заявки на попутку"
        label="Заявки Вологда — Череповец"
        onClick={() => {}}
      />
    </AppRoot>,
  );
}

describe("MenuRow", () => {
  it("имя строки = заголовок + подпись (видимая подпись входит в имя)", () => {
    const html = renderRow();
    expect(html).toContain('aria-label="Заявки Вологда — Череповец. Мои заявки на попутку"');
  });

  it("без label имя = заголовок + подпись", () => {
    const html = renderToString(
      <AppRoot platform="base">
        <MenuRow
          icon={<span>i</span>}
          title="Жалобы"
          subtitle="Сообщить о проблеме с пользователем"
          onClick={() => {}}
        />
      </AppRoot>,
    );
    expect(html).toContain(
      'aria-label="Жалобы. Сообщить о проблеме с пользователем"',
    );
  });

  it("нативная кнопка (реестр #12) и шеврон подсказочным цветом", () => {
    const html = renderRow();
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(css).toContain("color: var(--app-muted)");
  });

  it("строка на всю ширину родителя — иначе подпись растёт за карточку", () => {
    expect(css).toMatch(/\.row\s*\{[^}]*width:\s*100%/);
  });

  it("multiline прокидывается в кит: без него подпись режется многоточием", () => {
    // Кит по умолчанию рисует подпись с `white-space: nowrap` +
    // `text-overflow: ellipsis` (styles.css), а `multiline` снимает это —
    // единственный штатный способ не обрезать подпись. Пин на РЕАЛЬНЫЙ
    // эффект: один и тот же ряд с пропом и без него обязан давать разный
    // HTML (без пропа кит вешает на узел класс, снимающий nowrap-правило).
    // Сравнение с заведомо другим рядом проходило бы вхолостую.
    const row = (multiline?: boolean) =>
      renderToString(
        <AppRoot platform="base">
          <MenuRow
            icon={<span>i</span>}
            title="Вологда → Череповец"
            subtitle="2 человека · 7 мест · Завтра, 08:00"
            multiline={multiline}
            onClick={() => {}}
          />
        </AppRoot>,
      );
    expect(row(true)).not.toBe(row(false));
    // И подпись на месте целиком — многоточие её не съело.
    expect(row(true)).toContain("2 человека · 7 мест · Завтра, 08:00");
  });
});
