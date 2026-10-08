import { OfflineBanner } from "@/components/OfflineBanner";
import { Sheet } from "@/ui/Sheet";
import { FeedbackForm } from "./FeedbackForm";

/**
 * Всплывающее окно создания обращения в поддержку.
 *
 * Открывается с кнопки «Создать обращение» под списком «Мои обращения» на
 * странице /profile/support. Хост-managed (`open`/`onClose`): Back перехватывает
 * `useModalBack` на странице, фон — сама страница, поэтому в роут окно не
 * завернуто и его можно открыть откуда угодно позже без переделки роутера.
 *
 * `OfflineBanner` — обязателен именно здесь: портал шторки перекрывает
 * глобальный баннер из AppConfig, на страницах локальные копии не дублируются.
 *
 * a11y: нативный telegram-ui Modal (vaul Drawer поверх Radix Dialog) даёт
 * role=dialog + aria-modal, Esc/overlay-закрытие через onOpenChange,
 * focus-trap и возврат фокуса.
 */
export function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Фокус, Esc и Tab-trap — нативные (Radix FocusScope + onOpenChange); свой
  // role=dialog не добавляем — vaul уже рендерит dialog (двойной анонс).
  return (
    <Sheet open={open} onClose={onClose} title="Создать обращение">
      <OfflineBanner />
      <FeedbackForm onSubmitted={onClose} />
    </Sheet>
  );
}
