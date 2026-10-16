// @vitest-environment jsdom
// Регресс F15: ошибка формы обращения привязывается к тому контролу, о
// котором она говорит. Раньше validateSupportForm отдавала одну строку без
// указания поля, и `status="error"` ставился ОБОИМ контролам: жалоба на тему
// красила кольцо вокруг textarea, а у <Input> не появлялось ни aria-invalid,
// ни aria-describedby — при фокусе скринридер молчал (MEMORY.md §18).
//
// Проверяем ДЕРЕВО ДОСТУПНОСТИ, а не пропы: контролы ищем по роли и
// вычисленному доступному имени, описание — раскрываем через aria-describedby
// в текст узла. Проверка «статус-строка равна error» такой случай пропустила
// бы: кольцо на textarea и на <Input> выглядят одинаково.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
} from "@edem/contracts";

const { mockUseCreate, mockMutate } = vi.hoisted(() => ({
  mockUseCreate: vi.fn(),
  mockMutate: vi.fn(),
}));

vi.mock("@/queries/useSupportQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useSupportQuery")>();
  return { ...original, useCreateFeedbackMutation: mockUseCreate };
});

// Подтверждение — тост: после отправки окно закрывается, inline-Notice уехал бы
// вместе с ним.
vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: vi.fn() }) };
});

import { FeedbackForm } from "@/pages/Support/FeedbackForm";
import uiStyles from "@/ui/ui.module.css";

function renderForm() {
  return render(
    <AppRoot platform="base">
      <FeedbackForm />
    </AppRoot>,
  );
}

/** Контрол по доступному имени (label из ui/Field), а не по DOM-селектору. */
function controlByName(name: string): HTMLElement {
  return screen.getByRole("textbox", { name });
}

/**
 * Доступное описание контрола: текст узлов, перечисленных в aria-describedby
 * (тот же разбор, что делает dom-accessibility-api для описания).
 */
function accessibleDescription(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

/** id узла с текстом ошибки, если описание контрола чему-то указывает. */
function describedById(control: HTMLElement): string | null {
  return control.getAttribute("aria-describedby");
}

function isInvalid(control: HTMLElement): boolean {
  return control.getAttribute("aria-invalid") === "true";
}

function type(control: HTMLElement, value: string) {
  fireEvent.change(control, { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
}

beforeEach(() => {
  mockUseCreate.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FeedbackForm: ошибка поля привязана к своему контролу", () => {
  it("ошибка про ТЕМУ достаётся фокусом поля темы, а textarea не помечена", () => {
    renderForm();
    const subject = controlByName("Тема");
    const text = controlByName("Сообщение");
    // Сверхлимитная тема: canSubmit пропускает (поле не пустое), поэтому
    // проверяется РЕАЛЬНЫЙ путь — обработчик отправки, а не гейт кнопки.
    type(subject, "s".repeat(FEEDBACK_SUBJECT_MAX_LENGTH + 1));
    type(text, "не приходит уведомление");

    submit();

    const message = `Тема: максимум ${FEEDBACK_SUBJECT_MAX_LENGTH} символов`;
    // Фокус на поле — и описание сразу даёт текст ошибки.
    subject.focus();
    expect(document.activeElement).toBe(subject);
    expect(accessibleDescription(subject)).toBe(message);
    expect(isInvalid(subject)).toBe(true);

    // Узел ошибки — живой регион с тем самым текстом.
    const errorNode = document.getElementById(describedById(subject) ?? "");
    expect(errorNode?.getAttribute("role")).toBe("alert");
    expect(errorNode?.textContent).toBe(message);

    // Кольцо/невалидность на textarea быть не должно: ошибка не про него.
    expect(isInvalid(text)).toBe(false);
    expect(text.getAttribute("aria-describedby")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("ошибка про СООБЩЕНИЕ достаётся фокусом textarea, а поле темы не помечено", () => {
    renderForm();
    const subject = controlByName("Тема");
    const text = controlByName("Сообщение");
    type(subject, "Не приходит уведомление");
    type(text, "t".repeat(FEEDBACK_TEXT_MAX_LENGTH + 1));

    submit();

    const message = `Сообщение: максимум ${FEEDBACK_TEXT_MAX_LENGTH} символов`;
    text.focus();
    expect(document.activeElement).toBe(text);
    expect(accessibleDescription(text)).toBe(message);
    expect(isInvalid(text)).toBe(true);
    expect(
      document.getElementById(describedById(text) ?? "")?.textContent,
    ).toBe(message);

    expect(isInvalid(subject)).toBe(false);
    expect(subject.getAttribute("aria-describedby")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("правка поля гасит ТОЛЬКО свою ошибку", () => {
    renderForm();
    const subject = controlByName("Тема");
    const text = controlByName("Сообщение");
    type(subject, "тема");
    type(text, "t".repeat(FEEDBACK_TEXT_MAX_LENGTH + 1));
    submit();
    expect(isInvalid(text)).toBe(true);

    type(subject, "другая тема");

    expect(isInvalid(text)).toBe(true);
    expect(accessibleDescription(text)).toContain(
      String(FEEDBACK_TEXT_MAX_LENGTH),
    );

    // Как только сообщение стало валидным, форма уходит на отправку.
    type(text, "теперь корректно");
    expect(accessibleDescription(text)).toBe("");
    submit();
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("класс подписи поля на месте: правило --app-field-label не мёртвое", () => {
    renderForm();

    // Обёртка всегда несёт собственный класс Field (MEMORY.md §18), а
    // подпись — класс .fieldLabel: без них правило тона подписи мертво.
    // Классы хешированные, поэтому сверяемся с самим модулем ui/, а не со
    // строкой.
    for (const [label, control] of [
      ["support-subject", controlByName("Тема")],
      ["support-text", controlByName("Сообщение")],
    ] as const) {
      expect(control.closest(`.${uiStyles.fieldRoot}`)).not.toBeNull();
      expect(
        document.querySelector(`label[for="${label}"]`)?.className,
      ).toContain(uiStyles.fieldLabel);
    }
  });

  it("без ошибок у полей нет ни aria-invalid, ни aria-describedby", () => {
    renderForm();
    for (const name of ["Тема", "Сообщение"]) {
      const control = controlByName(name);
      expect(isInvalid(control)).toBe(false);
      expect(control.getAttribute("aria-describedby")).toBeNull();
      expect(accessibleDescription(control)).toBe("");
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
