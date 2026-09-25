import type { ReactNode, Ref } from "react";
import styles from "./ui.module.css";

export type NoticeTone = "danger" | "success" | "info" | "warning";
export type NoticeVariant = "text" | "banner" | "card";

export interface NoticeBaseProps {
  /** Смысловая роль → цвет/фон из --app-* токенов (инверсия light/dark в index.css). */
  tone?: NoticeTone;
  /**
   * Роль скринридера. По умолчанию зависит от тона: danger/warning → "alert"
   * (сообщение объявляется), success/info → "status" (вежливое объявление).
   * Явное значение перекрывает авто-выбор.
   */
  role?: "alert" | "status";
  className?: string;
  id?: string;
  children: ReactNode;
}

export type NoticeProps =
  /**
   * text — строка в потоке (ошибки форм); рендерит <p>, поэтому ref честно
   * типизирован как HTMLParagraphElement. Вариант по умолчанию.
   */
  | (NoticeBaseProps & {
      variant?: "text";
      /** ref на <p>-узел плашки: скролл к ошибке и т.п. */
      ref?: Ref<HTMLParagraphElement>;
    })
  /**
   * banner — полоса с тонированной подложкой (успех/ошибка блока);
   * card — карточка-подсказка на поверхности секции. Оба рендерят <div>,
   * поэтому ref честно типизирован как HTMLDivElement.
   */
  | (NoticeBaseProps & {
      variant: "banner" | "card";
      /** ref на <div>-узел плашки. */
      ref?: Ref<HTMLDivElement>;
    });

const ROLE_BY_TONE: Record<NoticeTone, "alert" | "status"> = {
  danger: "alert",
  warning: "alert",
  success: "status",
  info: "status",
};

/**
 * Единая плашка «сообщение пользователю»: ошибки полей (text), баннеры
 * успеха/ошибки блока (banner), карточки-подсказки (card). Роль одна,
 * рецептов больше нет — цвета только из --app-* токенов (образец StatusPill);
 * тёмную тему переключает index.css, а не каждый модуль.
 *
 * a11y: смысл всегда дублируется текстом, не только цветом (color + text);
 * role по умолчанию берётся из тона, см. выше.
 */
export function Notice(props: NoticeProps) {
  const {
    tone = "danger",
    role = ROLE_BY_TONE[tone],
    className = "",
    id,
    children,
  } = props;
  const variant: NoticeVariant = props.variant ?? "text";
  const merged = [styles.notice, className].filter(Boolean).join(" ");
  // Ветви явные (без динамического Tag): ref-тип каждой ветви совпадает
  // с реальным DOM-узлом — <p> для text, <div> для banner/card.
  if (variant !== "text") {
    const { ref } = props as Extract<NoticeProps, { variant: "banner" }>;
    return (
      <div
        ref={ref}
        id={id}
        role={role}
        data-tone={tone}
        data-variant={variant}
        className={merged}
      >
        {children}
      </div>
    );
  }
  const { ref } = props as Extract<NoticeProps, { variant?: "text" }>;
  return (
    <p
      ref={ref}
      id={id}
      role={role}
      data-tone={tone}
      data-variant={variant}
      className={merged}
    >
      {children}
    </p>
  );
}
