import { useState } from "react";
import {
  Button,
  Chip,
  IconButton,
  Input,
  Placeholder,
  Section,
  SegmentedControl,
  Slider,
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
import { TripCardsSkeleton } from "@/components/Skeletons";
import { TripFeedCard } from "@/components/Trip/TripFeedCard";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Stack } from "@/ui/Stack";
import { TRIP_TAGS } from "@/consts/tags";
import {
  DATE_SEGMENTS,
  EMPTY_SEARCH_FORM,
  PRICE_SLIDER_MAX,
  PRICE_SLIDER_MIN,
  PRICE_SLIDER_STEP,
  buildSearchFilters,
  formatMaxPriceLabel,
  parseDateSegmentParam,
  type SearchFormState,
} from "@/helpers/searchFilters";
import { useModalBack } from "@/utils/modalBack";
import { haptic } from "@/utils/haptics";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { useInfiniteTripsQuery } from "@/queries/useTripsQuery";
import type { TripTag } from "@edem/contracts";
import styles from "./SearchPage.module.css";

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
 * Поиск поездок (язык SearchTab примера): города + swap,
 * сегменты дат, сворачиваемый drawer фильтров (цена + теги). Пустые
 * фильтры — общая лента (бэкенд скрывает уехавшие: departureAt > now).
 * Стиль фильтров — SearchPage.module.css (миграция папка/компонент),
 * лента — TripFeedCard (поверхность FeedCard в module.css).
 */
export function SearchPage() {
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<SearchFormState>(() =>
    presetFromParams(searchParams),
  );
  const [submitted, setSubmitted] = useState<SearchFormState>(() =>
    presetFromParams(searchParams),
  );
  const [showFilters, setShowFilters] = useState(false);

  // Панель фильтров — state-drawer: нативный Back закрывает её, а не
  // уводит со страницы (тот же стек modalBack, что у state-модалок).
  useModalBack(() => setShowFilters(false), showFilters);

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

  const set = <K extends keyof SearchFormState>(
    key: K,
    value: SearchFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const swapCities = () => {
    haptic.selection();
    setForm((prev) => ({
      ...prev,
      fromCity: prev.toCity,
      toCity: prev.fromCity,
    }));
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
    form.maxPrice !== null ||
    form.tags.length > 0 ||
    form.dateSegment !== "all";

  return (
    <>
      <OfflineBanner />
      <Page>
        {/* Фильтр: поверхность — Section, заголовок — нативный.
            Чипы-действия — первой строкой тела (рядом с заголовком
            им не место: header принимает только текст). */}
        <Section header="Поиск попутных поездок">
          <SectionBody>
            <div className={styles.chipRow}>
              <Chip
                mode="mono"
                Component="a"
                href="#/ride-requests"
                className={styles.chip}
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
                className={styles.chip}
                aria-pressed={showFilters}
              >
                Фильтры
              </Chip>
            </div>

            <div className={styles.cityFields}>
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
                className={`${styles.swap} absolute! right-2! top-1/2! -translate-y-1/2!`}
              >
                <ArrowRightLeft size={14} className="text-(--app-info)" />
              </IconButton>
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
              <div className={styles.filtersPanel}>
                <div>
                  <div className={styles.priceHead}>
                    <span id="search-max-price-label">Цена не выше</span>
                    <Caption Component="span" aria-hidden="true">
                      {formatMaxPriceLabel(form.maxPrice)}
                    </Caption>
                  </div>
                  <Slider
                    min={PRICE_SLIDER_MIN}
                    max={PRICE_SLIDER_MAX}
                    step={PRICE_SLIDER_STEP}
                    value={form.maxPrice ?? PRICE_SLIDER_MAX}
                    onChange={(value) =>
                      set("maxPrice", value >= PRICE_SLIDER_MAX ? null : value)
                    }
                    aria-labelledby="search-max-price-label"
                    getAriaValueText={(value) =>
                      value >= PRICE_SLIDER_MAX
                        ? "Любая цена"
                        : formatMaxPriceLabel(value)
                    }
                  />
                </div>
                <div className={styles.tagsCol}>
                  <Caption
                    weight="2"
                    Component="span"
                    className={styles.tagsHead}
                  >
                    Условия поездки
                  </Caption>
                  <div className={styles.tagChips}>
                    {TRIP_TAGS.map((tag) => (
                      <Chip
                        key={tag}
                        className={styles.tagChip}
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

            <Button
              size="l"
              stretched
              mode="bezeled"
              before={<SearchIcon size={18} />}
              onClick={submit}
            >
              Найти
            </Button>
          </SectionBody>
        </Section>

        <div className={styles.resultsBar}>
          <Caption weight="2">Найдено поездок: {items.length}</Caption>
          <Caption Component="span">Цены без комиссии</Caption>
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
              <Button
                size="m"
                mode="bezeled"
                onClick={reset}
                disabled={!hasActiveFilters && !form.fromCity && !form.toCity}
              >
                Сбросить фильтры
              </Button>
            </Placeholder>
          ) : (
            <Stack>
              {items.map((trip) => (
                <TripFeedCard key={trip.id} trip={trip} />
              ))}
              {trips.hasNextPage && (
                <>
                  {/* Якорь автодогрузки: скрыт от скринридера, фиксированная
                      высота (48px) держит скролл от прыжков. */}
                  <div
                    ref={sentinelRef}
                    aria-hidden="true"
                    className={styles.sentinel}
                    style={{ overflowAnchor: "none" }}
                  />
                  {trips.isFetchingNextPage && (
                    <div
                      role="status"
                      aria-label="Загрузка ещё поездок"
                      className={styles.fetchMore}
                    >
                      <div className={styles.loadingMore}>
                        <div
                          className={styles.skeletonLine}
                          style={{ width: "45%" }}
                        />
                        <div
                          className={styles.skeletonLine}
                          style={{ width: "30%" }}
                        />
                      </div>
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
            </Stack>
          )}
        </QueryState>
      </Page>
    </>
  );
}
