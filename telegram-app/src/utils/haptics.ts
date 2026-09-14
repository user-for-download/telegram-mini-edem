import { hapticFeedback } from "@telegram-apps/sdk-react";
import { isSoundEnabled } from "@/utils/appSettings";

/**
 * Тактильная отдача в одном месте (язык примера edem-telegram-mini-app,
 * поверх sdk-react): все вызовы через ifAvailable — в браузере и SSR
 * безопасно становятся no-op, в Telegram-клиенте дают нативный отклик.
 * Гейт «Звук и вибрация» из профиля: выключено — тишина везде.
 */
const gated = (call: () => void) => () => {
  if (isSoundEnabled()) call();
};

export const haptic = {
  light: gated(() => void hapticFeedback.impactOccurred.ifAvailable("light")),
  medium: gated(() => void hapticFeedback.impactOccurred.ifAvailable("medium")),
  heavy: gated(() => void hapticFeedback.impactOccurred.ifAvailable("heavy")),
  selection: gated(() => void hapticFeedback.selectionChanged.ifAvailable()),
  success: gated(() => void hapticFeedback.notificationOccurred.ifAvailable("success")),
  warning: gated(() => void hapticFeedback.notificationOccurred.ifAvailable("warning")),
  error: gated(() => void hapticFeedback.notificationOccurred.ifAvailable("error")),
};
