import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Headline, Modal, VisuallyHidden } from "@telegram-apps/telegram-ui";
import { usePlatform } from "@/hooks/usePlatform";
import styles from "./ui.module.css";
import titleStyles from "./SheetTitle.module.css";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Текстовый заголовок — идёт в accessible name, только строка. */
  title: string;
  /**
   * Тело шторки: "padded" (по умолчанию) — скролл 82dvh и бока 16;
   * "edge" — без боковых (контент сам держит рельс: отзывы, досье);
   * "static" — без скролла (короткая форма обратной связи).
   */
  variant?: "padded" | "edge" | "static";
  children: ReactNode;
}

const BODY_VARIANTS = {
  padded: styles.sheetBody,
  edge: styles.sheetBodyEdge,
  static: styles.sheetBodyStatic,
} as const;

/**
 * Единая bottom-sheet шторка приложения: Modal + имя диалога + видимый
 * заголовок + тело. 9 модалок больше не дублируют обвязку.
 *
 * Единственное имя диалога: скрытый h2 (titleId, уходит в aria-labelledby
 * модалки). Видимые копии заголовка скрыты от скринридера — копия
 * в Modal.Header (рендерится только на iOS) обёрнута в aria-hidden span,
 * копия Headline на base — aria-hidden. Интерактивного содержимого
 * в заголовке быть не должно.
 *
 * Тело — div со скроллом из --app-sheet-* токенов; при открытии переносим
 * на него фокус (tabIndex={-1}, вне таб-порядка): точка входа для
 * клавиатуры и скринридера. Дальше — нативный trap vaul (Tab внутри
 * шторки, Esc — закрыть, фокус возвращается на триггер).
 */
export function Sheet({
  open,
  onClose,
  title,
  variant = "padded",
  children,
}: SheetProps) {
  // Закрытая шторка — null: платформа (контекст AppRoot) читается только
  // в открытом состоянии, SSR закрытых модалок не падает.
  if (!open) return null;
  return (
    <SheetOpen onClose={onClose} title={title} variant={variant}>
      {children}
    </SheetOpen>
  );
}

function SheetOpen({
  onClose,
  title,
  variant = "padded",
  children,
}: Pick<SheetProps, "onClose" | "title" | "variant"> & {
  children: ReactNode;
}) {
  const titleId = useId();
  const platform = usePlatform();
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={
        <Modal.Header>
          <span aria-hidden="true">{title}</span>
        </Modal.Header>
      }
      aria-labelledby={titleId}
    >
      <div
        ref={bodyRef}
        tabIndex={-1}
        className={BODY_VARIANTS[variant]}
      >
        {/* Имя диалога для скринридера — на всех платформах. */}
        <VisuallyHidden Component="h2" id={titleId}>
          {title}
        </VisuallyHidden>
        {platform !== "ios" && (
          <Headline
            Component="p"
            weight="2"
            aria-hidden="true"
            className={titleStyles.title}
          >
            {title}
          </Headline>
        )}
        {children}
      </div>
    </Modal>
  );
}
