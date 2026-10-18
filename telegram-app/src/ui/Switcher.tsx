import type { KeyboardEvent } from "react";
import { Chip } from "@/ui/Chip";
import { haptic } from "@/utils/haptics";
import styles from "./Switcher.module.css";

/**
 * Семантика переключателя.
 *
 * - `radiogroup` — одиночный выбор без панелей (фильтр даты, сегмент
 *   ленты). Канон APG для взаимно исключающих вариантов.
 * - `tabs` — переключение панелей: у выбранного пункта появляется
 *   `aria-controls`, панель ведёт на `panelId`.
 */
export type SwitcherSemantics = "radiogroup" | "tabs";

export interface SwitcherOption<T extends string> {
  value: T;
  label: string;
}

export interface SwitcherProps<T extends string> {
  options: ReadonlyArray<SwitcherOption<T>>;
  value: T;
  onChange: (next: T) => void;
  /** Доступное имя группы: «Фильтр уведомлений», «Разделы отзывов». */
  ariaLabel: string;
  /**
   * Префикс стабильных id пунктов (`${idPrefix}-${value}`).
   *
   * Стабильность обязательна: после стрелки фокус переезжает по id, а
   * сгенерированные id менялись бы между рендерами.
   */
  idPrefix: string;
  /** По умолчанию `radiogroup` — фильтр встречается чаще вкладок. */
  semantics?: SwitcherSemantics;
  /** id панели, которой управляет выбранная вкладка (только `tabs`). */
  panelId?: string;
  /**
   * Пункты равной ширины на всю строку (сегментный контрол) вместо
   * «облака пилюль» по содержимому.
   *
   * Нужен фильтрам с фиксированным набором из 4+ пунктов: «Все даты /
   * Сегодня / Завтра / Выходные» по содержимому не влезали в 324px и
   * переносились, оставляя последнюю пилюлю одну на второй строке —
   * раскладка читалась как сломанная. Равные сегменты влезают всегда:
   * ширину делит контейнер, а не текст.
   */
  stretch?: boolean;
}

/**
 * Переключатель «одно из N» — одна пилюля на всех экранах.
 *
 * Китовский `SegmentedControl` по умолчанию объявляет себя вкладками
 * (`role: "tablist"` / `role: "tab"`), поэтому для фильтров без панелей
 * он не подходит. Роли переопределяются здесь, один раз: кит спредит
 * `...restProps` **после** `role`, поэтому наш `role` выигрывает.
 *
 * Хаптика — здесь: `selectionChanged` на смену значения, одинаково
 * на всех экранах.
 *
 * Панель не рендерит: её держит владелец экрана, обязанный дать ей id из
 * `panelId`.
 */
export function Switcher<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  idPrefix,
  semantics = "radiogroup",
  panelId,
  stretch = false,
}: SwitcherProps<T>) {
  const asTabs = semantics === "tabs";
  // Есть ли value среди пунктов. Если нет (value вне options) — группа обязана
  // остаться достижимой по Tab: вход даём первому пункту (APG: в roving-группе
  // tabbable ровно один).
  const hasValue = options.some((option) => option.value === value);

  const pick = (next: T) => {
    if (next === value) return;
    haptic.selection();
    onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Пустой список: вести стрелкам некуда, и забирать клавишу (preventDefault)
    // нельзя — иначе группа молча глотает ввод.
    if (options.length === 0) return;
    const found = options.findIndex((option) => option.value === value);
    // value вне options (found === -1): точкой отсчёта берём первый пункт —
    // иначе `(index ± 1) % length` даёт NaN, а `next < 0` его НЕ отсекает
    // (NaN < 0 === false), и стрелка уходила бы в preventDefault впустую.
    const index = found < 0 ? 0 : found;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = options.length - 1;
    }
    if (next < 0) return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    pick(option.value);
    document.getElementById(`${idPrefix}-${option.value}`)?.focus();
  };

  return (
    <div
      role={asTabs ? "tablist" : "radiogroup"}
      aria-label={ariaLabel}
      className={stretch ? `${styles.row} ${styles.stretch}` : styles.row}
      onKeyDown={onKeyDown}
    >
      {options.map((option, optionIndex) => {
        const selected = option.value === value;
        // Ровно один tabbable: выбранный пункт, а при value вне options —
        // первый (группа не должна выпадать из Tab-порядка целиком).
        const tabbable = selected || (optionIndex === 0 && !hasValue);
        return (
          <Chip
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            role={asTabs ? "tab" : "radio"}
            /* Roving tabindex (APG): в группу входят Tab'ом и выходят сразу,
               внутри ходят стрелки. Без этого все N чипов шли подряд по Tab —
               то есть заявленная в докблоке семантика APG не выполнялась: для
               `tabs` Tab обязан перебрасывать между таб-листами, не заходя в
               каждый таб. Вход — на выбранном пункте, где пользователь и стоит.
               Клик по невыбранному схему не ломает: `pick` делает его выбранным,
               и tabIndex становится 0 (фокус после клика и так на нём). */
            tabIndex={tabbable ? 0 : -1}
            variant={selected ? "active" : "quiet"}
            className={selected ? styles.active : styles.item}
            {...(asTabs
              ? {
                  "aria-selected": selected,
                  "aria-controls": selected ? panelId : undefined,
                }
              : { "aria-checked": selected })}
            onClick={() => pick(option.value)}
          >
            {option.label}
          </Chip>
        );
      })}
    </div>
  );
}
