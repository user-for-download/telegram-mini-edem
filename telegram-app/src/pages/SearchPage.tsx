import { useState } from "react";
import {
  Button,
  Chip,
  IconButton,
  Input,
  Placeholder,
  SegmentedControl,
  Subheadline,
  Caption,
} from "@telegram-apps/telegram-ui";
import {
  ArrowRightLeft,
  Filter,
  MapPin,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QueryState } from "@/components/QueryState";
import { TripCardsSkeleton, TripCardSkeleton } from "@/components/Skeletons";
import { TripCard } from "@/components/TripCard";
import { QUICK_CITIES } from "@/consts/popularRoutes";
import { TRIP_TAGS } from "@/consts/tags";
import {
  DATE_SEGMENTS,
  EMPTY_SEARCH_FORM,
  buildSearchFilters,
  parseDateSegmentParam,
  type SearchFormState,
} from "@/helpers/searchFilters";
import { haptic } from "@/utils/haptics";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { useInfiniteTripsQuery } from "@/queries/useTripsQuery";
import type { TripTag } from "@edem/contracts";

/** Пресет из URL (?from&to&segment) — с главной/popular-routes. */
function presetFromParams(params: URLSearchParams): SearchFormState {
  return {
    ...EMPTY_SEARCH_FORM,
    fromCity: params.get("from") ?? "",
    toCity: params.get("to") ?? "",
    dateSegment: parseDateSegmentParam(params.get("segment")),
  };
}

/**
 * Поиск поездок (язык SearchTab примера): города + swap, чипы городов,
 * сегменты дат, сворачиваемый drawer фильтров (цена + теги). Пустые
 * фильтры — общая лента (бэкенд скрывает уехавшие: departureAt > now).
 */
export function SearchPage() {
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<SearchFormState>(() => presetFromParams(searchParams));
  const [submitted, setSubmitted] = useState<SearchFormState>(() => presetFromParams(searchParams));
  const [showFilters, setShowFilters] = useState(false);

  const trips = useInfiniteTripsQuery(buildSearchFilters(submitted));
  const items = trips.data?.pages.flatMap((page) => page.items) ?? [];
  // Сентинел автодогрузки: observer тянет следующую страницу через тот же
  // useInfiniteTripsQuery; без IntersectionObserver (SSR) тихо не работает,
  // контент виден сразу + остаётся fallback-кнопка «Показать ещё».
  const sentinelRef = useInfiniteSentinel({
    hasNextPage: trips.hasNextPage,
    isFetchingNextPage: trips.isFetchingNextPage,
    fetchNextPage: () => {
      void trips.fetchNextPage();
    },
  });

  const set = <K extends keyof SearchFormState>(key: K, value: SearchFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const swapCities = () => {
    haptic.selection();
    setForm((prev) => ({ ...prev, fromCity: prev.toCity, toCity: prev.fromCity }));
  };

  const pickQuickCity = (city: string) => {
    haptic.selection();
    setForm((prev) => (!prev.fromCity ? { ...prev, fromCity: city } : { ...prev, toCity: city }));
  };

  const toggleTag = (tag: TripTag) =>
    setForm((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter((item) => item !== tag)
        : [...prev.tags, tag],
    }));

  const submit = () => {
    haptic.light();
    setSubmitted(form);
  };

  const reset = () => {
    haptic.selection();
    setForm(EMPTY_SEARCH_FORM);
    setSubmitted(EMPTY_SEARCH_FORM);
  };

  const hasActiveFilters =
    Boolean(form.maxPrice.trim()) || form.tags.length > 0 || form.dateSegment !== "all";

  return (
    <>
      <OfflineBanner />
      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-4">
        <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Subheadline weight="2" className="text-[16px]!">
              Поиск попутных поездок
            </Subheadline>
            <div className="flex items-center gap-1.5">
              <Chip
                mode="mono"
                Component="a"
                href="#/ride-requests"
                className="text-xs!"
              >
                Ищу попутку
              </Chip>
              <Chip
                mode={showFilters ? "elevated" : "mono"}
                Component="button"
                onClick={() => {
                  haptic.selection();
                  setShowFilters(!showFilters);
                }}
                before={<Filter size={13} />}
                className="text-xs!"
                aria-pressed={showFilters}
              >
                Фильтры
              </Chip>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 relative">
            <Input
              id="search-from"
              before={<MapPin size={17} className="text-(--app-info)" />}
              after={
                form.fromCity ? (
                  <IconButton
                    type="button"
                    size="s"
                    mode="plain"
                    onClick={() => set("fromCity", "")}
                    aria-label="Очистить откуда"
                  >
                    <X size={14} className="text-(--tgui--hint_color)" />
                  </IconButton>
                ) : undefined
              }
              value={form.fromCity}
              onChange={(event) => set("fromCity", event.target.value)}
              placeholder="Откуда (город или село)"
            />
            <Input
              id="search-to"
              before={<MapPin size={17} className="text-(--app-success)" />}
              after={
                form.toCity ? (
                  <IconButton
                    type="button"
                    size="s"
                    mode="plain"
                    onClick={() => set("toCity", "")}
                    aria-label="Очистить куда"
                  >
                    <X size={14} className="text-(--tgui--hint_color)" />
                  </IconButton>
                ) : undefined
              }
              value={form.toCity}
              onChange={(event) => set("toCity", event.target.value)}
              placeholder="Куда (город или село)"
            />
            <IconButton
              type="button"
              size="s"
              mode="plain"
              onClick={swapCities}
              aria-label="Поменять направление"
              className="absolute! right-2! top-1/2! -translate-y-1/2! bg-(--tgui--section_bg_color)! shadow-xs!"
            >
              <ArrowRightLeft size={14} className="text-(--app-info)" />
            </IconButton>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {QUICK_CITIES.map((city) => (
              <Chip
                key={city}
                mode="mono"
                Component="button"
                onClick={() => pickQuickCity(city)}
                className="shrink-0 text-xs!"
              >
                {city}
              </Chip>
            ))}
          </div>

          <div role="tablist" aria-label="Дата поездки">
            <SegmentedControl>
              {DATE_SEGMENTS.map((option) => (
                <SegmentedControl.Item
                  key={option.value}
                  role="tab"
                  selected={form.dateSegment === option.value}
                  aria-selected={form.dateSegment === option.value}
                  onClick={() => {
                    haptic.selection();
                    set("dateSegment", option.value);
                  }}
                >
                  {option.label}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl>
          </div>

          {showFilters && (
            <div className="pt-2 border-t border-(--tgui--outline) flex flex-col gap-3">
              <div className="FormField">
                <label htmlFor="search-max-price">Цена не выше, ₽</label>
                <Input
                  id="search-max-price"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.maxPrice}
                  onChange={(event) => set("maxPrice", event.target.value)}
                  placeholder="Например: 300"
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-(--tgui--text_color)">
                  Условия поездки
                </span>
                <div className="TagChips">
                  {TRIP_TAGS.map((tag) => (
                    <Chip
                      key={tag}
                      className="TagChip"
                      mode={form.tags.includes(tag) ? "elevated" : "mono"}
                      Component="button"
                      aria-pressed={form.tags.includes(tag)}
                      onClick={() => {
                        haptic.selection();
                        toggleTag(tag);
                      }}
                    >
                      {tag}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          )}

          <Button size="l" stretched mode="filled" before={<SearchIcon size={18} />} onClick={submit}>
            Найти
          </Button>
        </div>

        <div className="flex items-center justify-between px-1">
          <Caption className="text-(--tgui--hint_color)! font-medium">
            Найдено поездок: {items.length}
          </Caption>
          <span className="text-[11px] text-(--tgui--hint_color)">
            Цены без комиссии
          </span>
        </div>

        <QueryState
          loading={trips.isLoading}
          error={trips.error}
          empty={false}
          emptyText=""
          skeleton={<TripCardsSkeleton />}
          onRetry={() => void trips.refetch()}
        >
          {items.length === 0 ? (
            <Placeholder
              header="Поездок не найдено"
              description="Попробуйте изменить города или выбрать другие даты отправления"
            >
              <Button size="m" mode="bezeled" onClick={reset} disabled={!hasActiveFilters && !form.fromCity && !form.toCity}>
                Сбросить фильтры
              </Button>
            </Placeholder>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((trip) => (
                <TripCard key={trip.id} trip={trip} />
              ))}
              {trips.hasNextPage && (
                <>
                  {/* Якорь автодогрузки: скрыт от скринридера, фиксированная
                      высота (min-h-12) держит скролл от прыжков. */}
                  <div
                    ref={sentinelRef}
                    aria-hidden="true"
                    className="flex min-h-12 items-center justify-center"
                    style={{ overflowAnchor: "none" }}
                  />
                  {trips.isFetchingNextPage && (
                    <div
                      role="status"
                      aria-label="Загрузка ещё поездок"
                      className="flex flex-col gap-3"
                    >
                      <TripCardSkeleton />
                      <TripCardSkeleton />
                    </div>
                  )}
                  <Button
                    stretched
                    mode="bezeled"
                    loading={trips.isFetchingNextPage}
                    disabled={trips.isFetchingNextPage}
                    onClick={() => void trips.fetchNextPage()}
                  >
                    Показать ещё
                  </Button>
                </>
              )}
            </div>
          )}
        </QueryState>
      </div>
    </>
  );
}
