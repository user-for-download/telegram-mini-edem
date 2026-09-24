import type { ReactNode, Ref } from "react";
import styles from "./ui.module.css";

export type NoticeTone = "danger" | "success" | "info" | "warning";
export type NoticeVariant = "text" | "banner" | "card";

export interface NoticeProps {
  /** Смысловая роль → цвет/фон из --app-* токенов (инверсия light/dark в index.css). */
  tone?: NoticeTone;
  /**
   * text — строка в потоке (ошибки форм);
   * banner — полоса с тонированной подложкой (успех/ошибка блока);
   * card — карточка-подсказка на поверхности секции.
   */
  variant?: NoticeVariant;
  /**
   * Роль скринридера. По умолчанию зависит от тона: danger/warning → "alert"
   * (сообщение объявляется), success/info → "status" (вежливое объявление).
   * Явное значение перекрывает авто-выбор.
   */
  role?: "alert" | "status";
  className?: string;
  id?: string;
  /** ref на DOM-узел плашки (text-вариант рендерит <p>): скролл к ошибке и т.п. */
  ref?: Ref<HTMLParagraphElement>;
  children: ReactNode;
}

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
export function Notice({
  tone = "danger",
  variant = "text",
  role = ROLE_BY_TONE[tone],
  className = "",
  id,
  ref,
  children,
}: NoticeProps) {
  const merged = [styles.notice, className].filter(Boolean).join(" ");
  const Tag = variant === "text" ? "p" : "div";
  return (
    <Tag
      ref={ref}
      id={id}
      role={role}
      data-tone={tone}
      data-variant={variant}
      className={merged}
    >
      {children}
    </Tag>
  );
}
