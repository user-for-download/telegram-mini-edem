import { describe, expect, it } from "vitest";
import {
  FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH,
  feedbackAppealRequestSchema,
  feedbackTelegramAppealDtoSchema,
} from "../index.js";

/**
 * Appeal-контракты —
 * POST /feedback/appeal принимает только TG-вариант ({ initData }).
 * Лимиты subject/text едины (100/2000), cap подписи — 4096.
 */
describe("feedback appeal contracts", () => {
  const subject = "Обжалование блокировки";
  const text = "Считаю блокировку ошибочной.";

  it("TG-вариант: принимает initData + subject + text", () => {
    const body = { initData: "user=%7B%22id%22%3A1%7D&hash=dev-hash", subject, text };
    expect(feedbackTelegramAppealDtoSchema.parse(body)).toEqual(body);
    const union = feedbackAppealRequestSchema.parse(body);
    expect("initData" in union).toBe(true);
  });

  it("отклоняет тело без initData", () => {
    expect(
      feedbackAppealRequestSchema.safeParse({ subject, text }).success,
    ).toBe(false);
  });

  it("отклоняет пустое тело", () => {
    expect(feedbackAppealRequestSchema.safeParse({}).success).toBe(false);
  });

  it("отклоняет пустую/пробельную initData", () => {
    expect(
      feedbackTelegramAppealDtoSchema.safeParse({ initData: "", subject, text })
        .success,
    ).toBe(false);
    expect(
      feedbackTelegramAppealDtoSchema.safeParse({ initData: "   ", subject, text })
        .success,
    ).toBe(false);
  });

  it(`cap initData ${FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH} (граница)`, () => {
    const ok = {
      initData: "a".repeat(FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH),
      subject,
      text,
    };
    expect(feedbackTelegramAppealDtoSchema.safeParse(ok).success).toBe(true);
    expect(
      feedbackTelegramAppealDtoSchema.safeParse({
        ...ok,
        initData: "a".repeat(FEEDBACK_APPEAL_INIT_DATA_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("пробельные subject/text отклоняются", () => {
    expect(
      feedbackTelegramAppealDtoSchema.safeParse({
        initData: "user=x&hash=dev-hash",
        subject: "   ",
        text,
      }).success,
    ).toBe(false);
    expect(
      feedbackTelegramAppealDtoSchema.safeParse({
        initData: "user=x&hash=dev-hash",
        subject,
        text: "   ",
      }).success,
    ).toBe(false);
  });

  it("сверхлимитные subject/text отклоняются", () => {
    const longSubject = "x".repeat(101);
    const longText = "x".repeat(2001);
    expect(
      feedbackTelegramAppealDtoSchema.safeParse({
        initData: "user=x&hash=dev-hash",
        subject: longSubject,
        text,
      }).success,
    ).toBe(false);
    expect(
      feedbackTelegramAppealDtoSchema.safeParse({
        initData: "user=x&hash=dev-hash",
        subject,
        text: longText,
      }).success,
    ).toBe(false);
  });
});
