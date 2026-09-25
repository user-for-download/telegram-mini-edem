import styles from "./ui.module.css";
import textStyles from "./text.module.css";
import layoutStyles from "./layout.module.css";

/**
 * Классы поверхности карточки для НЕстандартных контейнеров.
 *
 * Статичные карточки — через `ui/Card` (нативный TguiCard, Batch4).
 * Здесь — исключение для контейнеров, которые не могут быть article:
 * интерактивная `Tappable` ленты (button) и Skeleton-болванки.
 * Рецепт на tgui-токенах (ui.module.css .card), визуал legacy.
 * Новые места — только через ui/Card.
 */
export const CARD_SURFACE = styles.card;

/** Паддинг карточки 16 (default). */
export const CARD_PAD = styles.cardDefault;

/** Паддинг карточки 12 (compact). */
export const CARD_PAD_COMPACT = styles.cardCompact;

/* ── Текст (ui/text): одна роль — одно правило ────────────────────────
 * Расслабленный абзац, подпись-подсказка, центрирование. Заменяют
 * копии .prose/.proseText/.hintProse/.hint/.iconHint/.centerText
 * по модулям (см. ui/text.module.css). */

/** Расслабленный абзац (line-height 1.625). */
export const PROSE = textStyles.prose;

/** Тот же абзац основным цветом текста. */
export const PROSE_TEXT = textStyles.proseText;

/** Подпись-подсказка с межстрочным 1.625. */
export const HINT_PROSE = textStyles.hintProse;

/** Приглушённая подпись/иконка (цвет подсказки). */
export const HINT = textStyles.hint;

/** Центрированный текст пустого состояния. */
export const CENTER_TEXT = textStyles.centerText;

/** Семантический акцент «информация» (--app-info): иконки/ссылки. */
export const INFO = textStyles.info;

/** Семантический акцент «успех» (--app-success): подтверждения. */
export const SUCCESS = textStyles.success;

/* ── Раскладка (ui/layout): одна роль — одно правило ──────────────────
 * Обрезка, shrink/grow, ряды кнопок, ряд space-between. Заменяют
 * копии .truncate/.shrink/.grow/.btnRow/.rowBetween (см.
 * ui/layout.module.css). */

/** Обрезка в одну строку. */
export const TRUNCATE = layoutStyles.truncate;

/** Не сжимать элемент во флекс-ряду. */
export const SHRINK = layoutStyles.shrink;

/** Растущий блок с нулевой min-width (для ellipsis рядом). */
export const GROW = layoutStyles.grow;

/** Ряд кнопок действия (зазор 8px). */
export const BTN_ROW = layoutStyles.btnRow;

/** Тот же ряд с переносом. */
export const BTN_ROW_WRAP = layoutStyles.btnRowWrap;

/** Ряд space-between с зазором 8px. */
export const ROW_BETWEEN = layoutStyles.rowBetween;

/** Visually hidden label for screen readers (нативный TGUI-паттерн). */
export const VISUALLY_HIDDEN = textStyles.visuallyHidden;

/** Minimum 44px tap-target height (нативный хэш-класс, WCAG 2.5.8). */
export const MIN_TARGET = textStyles.minTarget;

/** Loading pulse animation (нативная, disabled under prefers-reduced-motion). */
export const PULSE = textStyles.pulse;
