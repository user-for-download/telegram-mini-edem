import type { ReactNode } from "react";
import { Modal } from "@telegram-apps/telegram-ui";
import { SheetTitle, useSheetTitleId } from "./SheetTitle";
import { SheetBody } from "@/ui/SheetBody";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /**
   * Тело шторки: "padded" (по умолчанию) — скролл 82dvh и бока 16;
   * "edge" — без боковых (контент сам держит рельс: отзывы, досье);
   * "static" — без скролла (короткая форма обратной связи).
   */
  variant?: "padded" | "edge" | "static";
  /** after в Modal.Header (кнопка закрытия — PassengerRequestModal). */
  headerAfter?: ReactNode;
  children: ReactNode;
}

/**
 * Единая bottom-sheet шторка приложения: Modal + имя диалога + видимый
 * заголовок + тело. Триптих SheetTitle (скрытый h2 для скринридера +
 * видимый заголовок на base-платформе) и связка aria-labelledby={titleId}
 * прячутся внутрь — 9 модалок больше не дублируют обвязку (раньше у
 * каждой был свой `<Modal header aria-labelledby><SheetTitle/></Modal>`).
 *
 * Единственное имя диалога: скрытый h2 SheetTitle (titleId). Видимые
 * копии заголовка скрыты от скринридера — копия в Modal.Header (рендерится
 * только на iOS) обёрнута в aria-hidden span, копия Headline на base —
 * aria-hidden в SheetTitle. title — текстовый заголовок (идёт в
 * accessible name), интерактивного содержимого в нём быть не должно.
 *
 * Тело — SheetBody (div со скроллом из --app-sheet-* токенов + перенос
 * фокуса при открытии); гостям шторки остаётся только контент. Контракты
 * прежних SheetBody/SheetTitle сохранены 1:1.
 */
export function Sheet({
  open,
  onClose,
  title,
  variant = "padded",
  headerAfter,
  children,
}: SheetProps) {
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={
        <Modal.Header after={headerAfter}>
          <span aria-hidden="true">{title}</span>
        </Modal.Header>
      }
      aria-labelledby={titleId}
    >
      <SheetBody variant={variant}>
        <SheetTitle titleId={titleId}>{title}</SheetTitle>
        {children}
      </SheetBody>
    </Modal>
  );
}
