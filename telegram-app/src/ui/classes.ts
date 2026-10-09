import styles from "./ui.module.css";
import textStyles from "./text.module.css";
import layoutStyles from "./layout.module.css";
import buttonResetStyles from "./buttonReset.module.css";

/**
 * Классы поверхности карточки для НЕстандартных контейнеров.
 *
 * Статичные карточки — через `ui/Card` (нативный TguiCard).
 * Здесь — исключение для контейнеров, которые не могут быть article:
 * интерактивная `Tappable` ленты (button) и Skeleton-болванки.
 * Рецепт на tgui-токенах (ui.module.css .card), визуал legacy.
 * Новые места — только через ui/Card.
 */
export const CARD_SURFACE = styles.card;

/** Паддинг карточки 16 (default). */
export const CARD_PAD = styles.cardDefault;

/* ── Текст (ui/text): одна роль — одно правило ────────────────────────
 * Расслабленный абзац, подпись-подсказка, центрирование. Заменяют
 * копии .prose/.proseText/.hint/.iconHint (см. ui/text.module.css). */

/** Расслабленный абзац (line-height 1.625). */
export const PROSE = textStyles.prose;

/** Тот же абзац основным цветом текста. */
export const PROSE_TEXT = textStyles.proseText;

/** Приглушённая подпись/иконка (цвет подсказки). */
export const HINT = textStyles.hint;

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

/** Visually hidden label for screen readers (рецепт как у TGUI VisuallyHidden). */
export const VISUALLY_HIDDEN = textStyles.visuallyHidden;

/** Minimum 44px tap-target height (класс приложения, WCAG 2.5.5 AAA). */
export const MIN_TARGET = textStyles.minTarget;

/**
 * Сброс UA-стилей нативной кнопки для КОМПОНЕНТОВ КИТА, переключённых в
 * `<button>` через `Component="button"` (Tappable/Cell/Accordion.Summary).
 *
 * `Component="button"` — документированный способ кита (Cell.d.ts) и
 * единственный путь с нативной семантикой: фокус, Enter/Space, роль кнопки.
 * Кит UA-стили не сбрасывает (шрифт, цвет, `appearance`, расхождение
 * `box-sizing` с div-путём) — подробности в buttonReset.module.css.
 *
 * Класс безвреден для `div` (appearance/background/border — no-op, inherit
 * уже поведение блока), поэтому его можно вешать на обе формы клетки: так
 * box-sizing одинаков и button- и div-пути считаются одинаково.
 */
export const AS_BUTTON = buttonResetStyles.asButton;

/**
 * Статичная строка-информация: клетка без обработчика.
 *
 * Кит внутри `Cell` всегда тянет `Tappable` (`cursor:pointer` + hover-подложка)
 * независимо от `Component`, поэтому строка, по которой нельзя нажать, без
 * этого класса выглядит кликабельной. Фасад не решает статичность за
 * вызывающего: интерактивность из пропсов не выводится, а строка уведомлений
 * интерактивна БЕЗ `Component="button"`.
 */
export const STATIC_CELL = styles.staticCell;

/** Loading pulse animation (анимация приложения, disabled under prefers-reduced-motion). */
export const PULSE = textStyles.pulse;
