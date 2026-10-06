import type { HTMLAttributes, ReactNode } from "react";

import { FieldError } from "@/ui/FieldError";
import styles from "./ui.module.css";

export interface FieldControl {
  id: string;
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
  /** Текст лейбла: он же доступное имя поля. Один источник. */
  label: string;
  /** id нативного контрола (htmlFor ↔ id). */
  id: string;
  /**
   * Текст ошибки поля. Включает aria-invalid + aria-describedby у контрола
   * и рендерит FieldError с id = errorId. Пустая строка / null / undefined —
   * обычное поле без ошибки.
   */
  error?: string | null;
  /** id узла ошибки; по умолчанию `${id}-error`. */
  errorId?: string;
  children: (control: FieldControl) => ReactNode;
}

/**
 * Поле формы: видимый лейбл + контрол (Input/Textarea/Select кита)
 * + опциональная ошибка, связанная через aria-describedby.
 *
 * Подпись рисуем сами, а не kit-`header`: в ките header — это FormInputTitle
 * ВНЕ <label> (доступное имя на нём держать нельзя), только на
 * platform === 'base' (на iOS у поля не было бы видимого имени), да ещё и
 * absolute поверх рамки — фокус-кольцо било сквозь текст. Свой label
 * одинаков на всех платформах: имя и видимая подпись — один узел.
 *
 * id берётся из одного источника (props label/id) — расхождение подписи
 * и поля невозможно. Обёртка не меняет раскладку и ритм (className/rest —
 * только опция для потребителя).
 *
 * Обратная совместимость: места без `error` рендерятся как обычное поле —
 * ошибка не появляется, лишних aria-атрибутов у контрола нет.
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
        "aria-describedby": describedBy,
        "aria-invalid": true,
      }
    : { id };
  return (
    <div
      {...rest}
      // Свой класс фасада — ALWAYS, а не только когда потребитель что-то
      // передал: по нему живут правила подписи и подложки
      // (.fieldLabel, .fieldRoot > div > label в ui.module.css).
      // Без класса правила мёртвые.
      className={className ? `${styles.fieldRoot} ${className}` : styles.fieldRoot}
    >
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      {children(control)}
      <FieldError error={error} id={describedBy} />
    </div>
  );
}
