// Юнит-тесты чистых форматтеров строки/статуса обращения (DOM-free).
// Паттерн reportPreview.test.ts: логику покрываем без рендера.
import { describe, expect, it } from "vitest";
import type { UserFeedbackDto } from "@edem/contracts";

import {
  feedbackCellAriaLabel,
  feedbackPreviewSubtitle,
  feedbackStatus,
} from "@/pages/Support/feedbackPreview";

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

describe("feedbackStatus", () => {
  it("без ответа — «Ждём ответа» тоном warning", () => {
    expect(feedbackStatus(feedback())).toEqual({
      label: "Ждём ответа",
      tone: "warning",
    });
  });

  it("с ответом — «Есть ответ» тоном info", () => {
    expect(
      feedbackStatus(feedback({ reply: "Разобрались" })),
    ).toEqual({ label: "Есть ответ", tone: "info" });
  });
});

describe("feedbackPreviewSubtitle", () => {
  it("отдаёт текст как есть (обрезку делает кит)", () => {
    expect(feedbackPreviewSubtitle(feedback())).toBe(
      "Не пришло подтверждение брони",
    );
  });

  it("пробельный текст — undefined, строка не схлопывается в пустую", () => {
    expect(feedbackPreviewSubtitle(feedback({ text: "   " }))).toBeUndefined();
  });
});

describe("feedbackCellAriaLabel", () => {
  it("включает тему, статус и действие", () => {
    const label = feedbackCellAriaLabel(feedback());
    expect(label).toContain("Обращение: Нет уведомления");
    expect(label).toContain("Ждём ответа");
    expect(label).toContain("открыть подробности");
  });
});
