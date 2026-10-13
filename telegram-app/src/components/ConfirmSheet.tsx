import { Text } from "@telegram-apps/telegram-ui";

import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { Stack } from "@/ui/Stack";
import { useModalBack } from "@/utils/modalBack";
import styles from "./ConfirmPopup.module.css";

/**
 * Подтверждение в шторке — для площадок без нативного алерта Telegram.
 *
 * Почему не инлайн-панель под кнопкой (как было раньше): стенд в браузере
 * и Telegram для macOS — единственные среды, где `popup.show` недоступен, и
 * в них подтверждение рисует НАТИВНУЮ модалку клиента. Один вид на всех
 * площадках вместо двух, плюс нативные фокус-ловушка, Esc и возврат фокуса
 * на триггер — вместо ручной укладки в бывшем инлайн-ConfirmAction.
 *
 * Ветка macOS (mockTelegramEnv) раньше выполняла деструктивное действие
 * СРАЗУ, без гейта вообще: SDK там врёт `isAvailable() === true`, а
 * показать диалог нечем. Этот Sheet закрывает и её — «Удалить профиль» на
 * macOS больше не удаляет аккаунт одним тапом.
 *
 * Хост-managed (`open`/`onClose`): кит ведёт себя по `open`, а нативная
 * кнопка «Назад» закрывает шторку через `useModalBack(onClose, open)` —
 * без этой подписки Back ушёл бы со страницы вместе с экраном под шторкой.
 *
 * Портал шторки уводит клики из карточки-соседа, поэтому `stopPropagation`
 * нужен только на триггере.
 */
export function ConfirmSheet({
  open,
  onClose,
  confirmLabel,
  description,
  pending = false,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** Заголовок окна и одновременно текст кнопки подтверждения. */
  confirmLabel: string;
  description: string;
  /** Действие в полёте: кнопка в loading и повторный клик гаснут. */
  pending?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  // Нативная кнопка «Назад» закрывает шторку, а не уводит с экрана:
  // без этой подписки Back ушёл бы по истории вместе со страницей.
  useModalBack(onClose, open);
  return (
    <Sheet open={open} onClose={onClose} title={confirmLabel}>
      <Stack>
        <Text Component="p">{description}</Text>
        <Stack gap="xs">
          {/* Подтверждение деструктива — всегда primary (filled): иначе
              неотличимо от «Отмена» (тот же довод, что был в инлайн-панели). */}
          <Button
            variant="primary"
            stretched
            size="m"
            loading={pending}
            disabled={pending}
            className={destructive ? styles.destructive : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="gray" stretched size="m" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
        </Stack>
      </Stack>
    </Sheet>
  );
}
