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
}: SwitcherProps<T>) {
  const asTabs = semantics === "tabs";

  const pick = (next: T) => {
    if (next === value) return;
    haptic.selection();
    onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === value);
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
      className={styles.row}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Chip
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            role={asTabs ? "tab" : "radio"}
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
