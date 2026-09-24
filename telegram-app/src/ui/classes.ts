import styles from "./ui.module.css";

/**
 * Классы поверхности карточки для НЕстандартных контейнеров.
 *
 * `ui/Card` рендерит div и покрывает 90% мест. Но есть контейнеры, которые
 * нельзя заменить на div без потери поведения: интерактивная `Tappable`
 * (button), карточка-строка на `<button>`, обёртка над китовой `Card`.
 * Для них экспортируем класс из единого источника (ui.module.css), как это
 * уже сделано для `ROUTE_FADE_CLASS` в AppShell: правило одно, контейнер
 * любой. Прецедент канона: экспорт хэш-класса из модуля.
 */
export const CARD_SURFACE = styles.card;

/** Паддинг карточки 16 (default). */
export const CARD_PAD = styles.cardDefault;

/** Паддинг карточки 12 (compact). */
export const CARD_PAD_COMPACT = styles.cardCompact;
