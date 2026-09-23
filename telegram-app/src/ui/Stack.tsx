import type { HTMLAttributes } from "react";
import styles from "./ui.module.css";

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
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className ? `${styles.stack} ${className}` : styles.stack}
      {...rest}
    >
      {children}
    </div>
  );
}
