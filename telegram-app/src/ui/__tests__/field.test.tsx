// Тесты Field/FieldError без @testing-library/react (не установлен):
// react-dom/server renderToString — паттерн
// telegram-app/src/components/__tests__/statusPill.test.tsx.
// Проверяем: обратную совместимость (без error — как раньше), связку
// ошибки через aria-describedby (+aria-invalid), className/rest-пропсы.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { Field, type FieldControl } from "@/ui/Field";
import { FieldError } from "@/ui/FieldError";

function probeControl(
  props: Omit<Parameters<typeof Field>[0], "children">,
): FieldControl | undefined {
  let seen: FieldControl | undefined;
  renderToString(
    <Field {...props}>
      {(control) => {
        seen = control;
        return null;
      }}
    </Field>,
  );
  return seen;
}

describe("Field", () => {
  it("backward compat: без error контрол — только id/header, ошибки в DOM нет", () => {
    const control = probeControl({ label: "Имя", id: "profile-name" });
    expect(control).toEqual({ id: "profile-name", header: "Имя" });

    const html = renderToString(
      <Field label="Имя" id="profile-name">
        {(field) => <input {...field} aria-label={field.header} />}
      </Field>,
    );
    expect(html).toContain('for="profile-name"');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain('role="alert"');
  });

  it("error связывает контрол и текст: aria-describedby + aria-invalid + id узла", () => {
    const control = probeControl({
      label: "Комментарий",
      id: "review-text",
      error: "Расскажите подробнее",
    });
    expect(control).toEqual({
      id: "review-text",
      header: "Комментарий",
      "aria-describedby": "review-text-error",
      "aria-invalid": true,
    });

    const html = renderToString(
      <Field label="Комментарий" id="review-text" error="Расскажите подробнее">
        {(field) => (
          <textarea
            id={field.id}
            aria-label={field.header}
            aria-describedby={field["aria-describedby"]}
            aria-invalid={field["aria-invalid"]}
          />
        )}
      </Field>,
    );
    expect(html).toContain('aria-describedby="review-text-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="review-text-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Расскажите подробнее");
  });

  it("errorId переопределяет id узла ошибки с обеих сторон связки", () => {
    const control = probeControl({
      label: "Тема",
      id: "support-subject",
      error: "Укажите тему",
      errorId: "support-form-error",
    });
    expect(control?.["aria-describedby"]).toBe("support-form-error");

    const html = renderToString(
      <Field
        label="Тема"
        id="support-subject"
        error="Укажите тему"
        errorId="support-form-error"
      >
        {(field) => (
          <input
            id={field.id}
            aria-label={field.header}
            aria-describedby={field["aria-describedby"]}
          />
        )}
      </Field>,
    );
    expect(html).toContain('aria-describedby="support-form-error"');
    expect(html).toContain('id="support-form-error"');
    expect(html).not.toContain("support-subject-error");
  });

  it("пустой error (''/null) — как без ошибки", () => {
    for (const error of ["", null, undefined] as const) {
      const control = probeControl({ label: "Цена", id: "x", error });
      expect(control).toEqual({ id: "x", header: "Цена" });
    }
    const html = renderToString(
      <Field label="Цена" id="x" error="">
        {() => null}
      </Field>,
    );
    expect(html).not.toContain('role="alert"');
  });

  it("className и rest-пропсы уходят на обёртку", () => {
    const html = renderToString(
      <Field
        label="Куда"
        id="ride-to"
        className="mt-2"
        data-testid="ride-to-field"
      >
        {() => null}
      </Field>,
    );
    expect(html).toContain('class="mt-2"');
    expect(html).toContain('data-testid="ride-to-field"');
  });
});

describe("FieldError", () => {
  it("пустой error → пустой рендер", () => {
    for (const error of ["", null, undefined] as const) {
      expect(renderToString(<FieldError error={error} />)).toBe("");
    }
  });

  it("рендерит текст с id и className", () => {
    const html = renderToString(
      <FieldError error="Обязательное поле" id="f-error" className="mt-1" />,
    );
    expect(html).toContain('id="f-error"');
    expect(html).toContain("mt-1");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Обязательное поле");
  });
});
