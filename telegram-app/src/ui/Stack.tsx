import type { HTMLAttributes } from "react";
import styles from "./ui.module.css";

export type StackGap = "sm" | "xs" | "2xs";

const GAP_CLASS = {
  xs: styles.stackGapXs,
  "2xs": styles.stackGap2xs,
};

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Ритм стека из токенов --app-space-*: "sm" (12, по умолчанию) —
   * обычный ритм страниц/секций; "xs" (8) — плотные кнопки диалога;
   * "2xs" (4) — подпись вплотную к кнопке. Заменяет style={{ gap: N }}
   * (U3: Onboarding, EditProfileModal) и margin-pull-up поверх ритма
   * (U3: TripDetails — статус шаринга).
   */
  gap?: StackGap;
}

/**
 * Вертикальный стек: столбец с ритмом 12 из токена `--app-space-sm`.
 *
 * Замена локальным `.stack`/`.form`/`.list`/`.feed` с
 * `display:flex; flex-direction:column; gap:12px` — один ритм на всё
 * приложение вместо десятков копий.
 *
 * Это обычный div, а не List: вне корня экрана List даёт только
 * платформенный паддинг (iOS 10px/18px) и китовое значение ритма вместо
 * нашего токена. List — только корень экрана (см. Page).
 */
export function Stack({
  gap = "sm",
  className,
  children,
  ...rest
}: StackProps) {
  return (
    <div
      className={[styles.stack, gap !== "sm" ? GAP_CLASS[gap] : undefined, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
