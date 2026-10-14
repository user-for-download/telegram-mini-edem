// SSR-тесты тела попапа обращения (`FeedbackDetailsBody`).
//
// Тело экспортируется отдельно от `FeedbackDetailsModal` намеренно: Modal кита
// — портал, в renderToString не попадает (тот же приём, что у
// `ReportDetailsBody` и `TripRequestsBody`).
//
// Смысл проверок прежней карточки сохранён: ответ поддержки и полный текст
// обращения ОБЯЗАНЫ где-то показываться, просто теперь в попапе.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { UserFeedbackDto } from "@edem/contracts";

import { FeedbackDetailsBody } from "@/pages/Support/FeedbackDetailsModal";
import uiStyles from "@/ui/ui.module.css";
import pageStyles from "@/pages/Support/SupportPage.module.css";
import pillStyles from "@/components/StatusPill/StatusPill.module.css";

function feedback(overrides: Partial<UserFeedbackDto> = {}): UserFeedbackDto {
  return {
    id: "f-1",
    subject: "Нет уведомления",
    text: "Не пришло подтверждение брони",
    reply: null,
    repliedAt: null,
    createdAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

function renderBody(f: UserFeedbackDto = feedback()): string {
  return renderToString(
    <AppRoot platform="base">
      <FeedbackDetailsBody feedback={f} />
    </AppRoot>,
  );
}

describe("FeedbackDetailsBody: содержимое попапа", () => {
  it("показывает тему и статус обращения", () => {
    const html = renderBody();
    expect(html).toContain("Нет уведомления");
    expect(html).toContain("Ждём ответа");
  });

  it("дата отправки по Москве", () => {
    expect(renderBody()).toContain("Отправлено 09.09.2026");
  });

  it("полный текст обращения, а не обрезанная строка", () => {
    const long = "Не пришло уведомление. ".repeat(50);
    expect(renderBody(feedback({ text: long }))).toContain(
      "Не пришло уведомление.",
    );
  });

  it("ответ поддержки показан, когда он есть", () => {
    const html = renderBody(
      feedback({
        reply: "Проверили: уведомление доставлено.",
        repliedAt: "2026-09-10T16:00:00.000Z",
      }),
    );
    expect(html).toContain("Ответ поддержки · 10.09.2026");
    expect(html).toContain("Проверили: уведомление доставлено.");
  });

  it("без ответа — справка вместо блока ответа", () => {
    const html = renderBody();
    expect(html).not.toContain("Ответ поддержки");
    expect(html).toContain("Поддержка ещё не ответила");
  });

  it("статус — пилюлей в одной шапке с темой", () => {
    const html = renderBody(feedback({ reply: "Ответ" }));
    expect(html).toContain(pageStyles.detailsHead as string);
    expect(html).toContain(pillStyles.pill as string);
    expect(html).toContain('data-tone="info"');
  });

  it("как ждём ответа, так и «есть ответ» подписаны словами", () => {
    expect(renderBody()).toContain("Ждём ответа");
    expect(renderBody(feedback({ reply: "Ответ" }))).toContain("Есть ответ");
  });
});

describe("Тело попапа: свободные тексты в плашках", () => {
  it("текст обращения лежит в плашке-цитате", () => {
    expect(renderBody()).toContain(uiStyles.quote as string);
  });

  it("ответ поддержки — тоже плашка", () => {
    const html = renderBody(feedback({ reply: "Разобрались" }));
    // Плашки две: обращение и ответ.
    expect(html.split(uiStyles.quote as string).length - 1).toBe(2);
  });

  it("переносы строк обращения сохраняются", () => {
    expect(renderBody(feedback({ text: "строка 1\nстрока 2" }))).toContain(
      "строка 1\nстрока 2",
    );
  });
});
