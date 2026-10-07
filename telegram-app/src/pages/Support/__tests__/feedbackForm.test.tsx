// SSR-тесты формы обращения в поддержку — тело всплывающего окна
// FeedbackModal (Modal — портал и в renderToString не попадает).
// Паттерн tripsPages.test.tsx (SSR, моки хуков через vi.hoisted).
//
// id полей (`support-subject`, `support-text`) — контракт e2e-сценария
// telegram-parity и замера контраста плейсхолдеров, поэтому пинятся здесь.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
} from "@edem/contracts";

const { mockUseCreate } = vi.hoisted(() => ({ mockUseCreate: vi.fn() }));

vi.mock("@/queries/useSupportQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useSupportQuery")>();
  return { ...original, useCreateFeedbackMutation: mockUseCreate };
});

// Тост подтверждения: после отправки окно закрывается, поэтому inline-Notice
// уехал бы вместе с ним.
vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: vi.fn() }) };
});

import { FeedbackForm } from "@/pages/Support/FeedbackForm";

function renderForm(): string {
  return renderToString(
    <AppRoot platform="base">
      <FeedbackForm />
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseCreate.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("FeedbackForm", () => {
  it("поля с браузерными maxLength из контракта", () => {
    const html = renderForm();

    expect(html).toContain('id="support-subject"');
    expect(html).toContain('id="support-text"');
    // React 19 в SSR пишет атрибут как maxLength (не в нижнем регистре) —
    // сравниваем ровно то, что приходит в HTML.
    expect(html).toContain(`maxLength="${FEEDBACK_SUBJECT_MAX_LENGTH}"`);
    expect(html).toContain(`maxLength="${FEEDBACK_TEXT_MAX_LENGTH}"`);
    expect(html).toContain("Отправить");
  });

  it("подписи полей и плейсхолдеры на месте", () => {
    const html = renderForm();

    expect(html).toContain("Тема");
    expect(html).toContain("Сообщение");
    expect(html).toContain("Например: не приходит уведомление");
    expect(html).toContain("Расскажите подробнее, что произошло");
  });

  it("кнопка отправки погашена, пока поля пусты", () => {
    const html = renderForm();

    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Отправить/);
  });

  it("самой страницы в форме нет — только поля", () => {
    // Форма живёт в окне: FAQ и «Мои обращения» — на странице (SupportPage).
    const html = renderForm();

    expect(html).not.toContain("Частые вопросы");
    expect(html).not.toContain("Мои обращения");
  });
});