import type { HTMLAttributes, ReactNode } from "react";

import { FieldError } from "@/ui/FieldError";

export interface FieldControl {
  id: string;
  header: string;
  /**
   * id узла с текстом ошибки (FieldError ниже). Присутствует, только пока
   * есть ошибка: потребитель спредит контроль в Input/Textarea/Select кита
   * ({...field}) и связка label ↔ поле ↔ ошибка собирается сама.
   */
  "aria-describedby"?: string;
  /** true, пока есть ошибка (a11y: состояние — не только цветом/статусом). */
  "aria-invalid"?: boolean;
}

export interface FieldProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Текст лейбла: он же доступное имя поля и header кита. Один источник. */
  label: string;
  /** id нативного контрола (htmlFor ↔ id). */
  id: string;
  /**
   * Текст ошибки поля. Включает aria-invalid + aria-describedby у контрола
   * и рендерит FieldError с id = errorId. Пустая строка / null / undefined —
   * обычное поле без ошибки (как раньше).
   */
  error?: string | null;
  /** id узла ошибки; по умолчанию `${id}-error`. */
  errorId?: string;
  children: (control: FieldControl) => ReactNode;
}

/**
 * Поле формы: sr-only лейбл + контрол (Input/Textarea/Select кита)
 * + опциональная ошибка, связанная через aria-describedby.
 *
 * Почему sr-only, а не kit-`header`: в kите header рисует FormInputTitle
 * ВНЕ <label> и только на platform === 'base' (на iOS текста нет вообще,
 * см. FormInput.js) — на видимом заголовке держать доступное имя нельзя.
 * Наши label+htmlFor дают имя на всех платформах.
 *
 * id и header берутся из одного источника (props label/id) — расхождение
 * подписи и заголовка поля невозможно. Обёртка — тот же div, что был:
 * раскладка и ритм не меняются (className/rest — только опция для
 * потребителя, по умолчанию обёртка без атрибутов, как раньше).
 *
 * Обратная совместимость: места без `error` (Search/CreateTrip/Reports/
 * Support/Reviews и др.) рендерятся ровно как раньше — ошибка не
 * появляется, лишних aria-атрибутов у контрола нет.
 */
export function Field({
  label,
  id,
  error,
  errorId,
  className,
  children,
  ...rest
}: FieldProps) {
  const hasError = Boolean(error);
  const describedBy = errorId ?? `${id}-error`;
  const control: FieldControl = hasError
    ? {
        id,
        header: label,
        "aria-describedby": describedBy,
        "aria-invalid": true,
      }
    : { id, header: label };
  return (
    <div {...rest} className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {children(control)}
      <FieldError error={error} id={describedBy} />
    </div>
  );
}
