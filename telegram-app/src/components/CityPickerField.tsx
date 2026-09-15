import { useEffect, useRef, useState } from "react";
import { IconButton, Input } from "@telegram-apps/telegram-ui";
import { MapPin, X } from "lucide-react";
import { haptic } from "@/utils/haptics";

export interface PickerCity {
  id: string;
  name: string;
}

/**
 * Чистый фильтр справочника по подстроке (case-insensitive).
 * Вынесен ради юнит-тестов без DOM.
 */
export function filterCities(
  cities: readonly PickerCity[] | undefined,
  query: string,
): PickerCity[] {
  if (!cities) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [...cities];
  return cities.filter((city) => city.name.toLowerCase().includes(q));
}

const VISIBLE_LIMIT = 8;

/**
 * Точное совпадение по имени (trim + case-insensitive): набранное полное
 * название — подтверждённый выбор (e2e печатает полное имя и жмёт сабмит).
 */
export function findExactCity(
  cities: readonly PickerCity[] | undefined,
  query: string,
): PickerCity | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return cities?.find((city) => city.name.toLowerCase() === q) ?? null;
}

/**
 * Поле выбора города с вводом (вместо нативного Select: в нём 25+ городов
 * приходится скроллить). Печатаешь подстроку — список фильтруется,
 * тап — выбирает. Закрытие: выбор, Esc, blur. clavier: ↑/↓/Enter.
 * Значение для родителя — имя города (валидатор createTripForm без изменений).
 * SSR-safe: эффектов с DOM нет, дропдаун по умолчанию закрыт.
 */
export function CityPickerField({
  id,
  label,
  value,
  cities,
  placeholder,
  status,
  onSelect,
}: {
  id: string;
  label: string;
  value: string;
  cities: readonly PickerCity[] | undefined;
  placeholder: string;
  status?: "default" | "error";
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Внешние изменения значения (swap городов) — подтягиваем в поле.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const matches = filterCities(cities, open ? query : "");
  const visible = matches.slice(0, VISIBLE_LIMIT);

  const choose = (name: string) => {
    haptic.selection();
    onSelect(name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const revert = () => {
    // Полное имя — автовыбор (иначе текст сотрётся, а выбор не случится).
    const exact = findExactCity(cities, query);
    if (exact && exact.name !== value) {
      choose(exact.name);
      return;
    }
    setQuery(value);
    setOpen(false);
  };

  return (
    <div className="FormField">
      <label htmlFor={id}>{label}</label>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          before={<MapPin size={17} className="text-(--app-info)" />}
          after={
            value ? (
              <IconButton
                type="button"
                size="s"
                mode="plain"
                onClick={() => choose("")}
                aria-label={`Очистить: ${label}`}
              >
                <X size={14} className="text-(--tgui--hint_color)" />
              </IconButton>
            ) : undefined
          }
          value={open ? query : value}
          status={status}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          placeholder={placeholder}
          onFocus={() => {
            setQuery(value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onBlur={revert}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              revert();
              inputRef.current?.blur();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((prev) => Math.min(prev + 1, visible.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((prev) => Math.max(prev - 1, 0));
            } else if (event.key === "Enter") {
              const pick = visible[activeIndex];
              if (open && pick) {
                event.preventDefault();
                choose(pick.name);
              }
            }
          }}
        />
        {open && (
          <div
            id={`${id}-listbox`}
            role="listbox"
            aria-label={label}
            className="absolute! left-0! right-0! top-full! z-10! mt-1! max-h-56! overflow-y-auto! rounded-xl! border! border-(--tgui--outline)! bg-(--tgui--section_bg_color)! shadow-lg!"
          >
            {visible.map((city, index) => (
              <button
                key={city.id}
                type="button"
                role="option"
                aria-selected={value === city.name}
                // mousedown раньше blur: выбор срабатывает до закрытия.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(city.name)}
                onMouseEnter={() => setActiveIndex(index)}
                className={[
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left text-[15px] transition-colors",
                  index === activeIndex
                    ? "bg-(--tgui--secondary_fill) text-(--tgui--text_color)"
                    : "text-(--tgui--text_color)",
                ].join(" ")}
              >
                <MapPin size={15} className="shrink-0 text-(--tgui--hint_color)" />
                <span className="truncate">{city.name}</span>
              </button>
            ))}
            {visible.length === 0 && (
              <p className="px-3 py-2.5 text-[13px] text-(--tgui--hint_color)">
                Нет таких городов в справочнике
              </p>
            )}
            {matches.length > VISIBLE_LIMIT && (
              <p className="px-3 py-1.5 text-[11px] text-(--tgui--hint_color)">
                {`Показаны первые ${VISIBLE_LIMIT} — уточните запрос`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
