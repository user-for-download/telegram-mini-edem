import type { ReactNode } from "react";

export interface FieldControl {
  id: string;
  header: string;
}

export interface FieldProps {
  /** Текст лейбла: он же доступное имя поля и header кита. Один источник. */
  label: string;
  /** id нативного контрола (htmlFor ↔ id). */
  id: string;
  children: (control: FieldControl) => ReactNode;
}

/**
 * Поле формы: sr-only лейбл + контрол (Input/Textarea/Select кита).
 *
 * Почему sr-only, а не kit-`header`: в kите header рисует FormInputTitle
 * ВНЕ <label> и только на platform === 'base' (на iOS текста нет вообще,
 * см. FormInput.js) — на видимом заголовке держать доступное имя нельзя.
 * Наши label+htmlFor дают имя на всех платформах.
 *
 * id и header берутся из одного источника (props label/id) — расхождение
 * подписи и заголовка поля невозможно. Обёртка — тот же div, что был:
 * раскладка и ритм не меняются.
 */
export function Field({ label, id, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {children({ id, header: label })}
    </div>
  );
}
