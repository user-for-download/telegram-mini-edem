import { useState } from "react";
import {
  Input,
  Section,
  SegmentedControl,
  Slider,
  Caption,
} from "@telegram-apps/telegram-ui";

import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { IconButton } from "@/ui/IconButton";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { FetchMore } from "@/ui/FetchMore";
import { BTN_ROW_WRAP, HINT, INFO, SUCCESS } from "@/ui/classes";

import {
  ArrowRightLeft,
  Filter,
  MapPin,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
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
 * лента — TripFeedCard (тонкая обёртка над эталоном TripStandardCard).
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

  // B3: пресет из URL применяется НЕ только на маунте. Страница не
  // перемонтируется при смене ?from/?to/?segment: route-fade от AppRouter
  // нарочно key'ится одним pathname (иначе смена query роняет скролл и
  // скелетоны), поэтому useState-инициализатор срабатывал ровно один раз
  // и повторный переход «Главная → Поиск» с другим маршрутом показывал
  // прошлую выдачу (так ведут PopularRoutesSection на главной и
  // deep-link токены).
  //
  // Синхронизация фазой рендера, а не эффектом: эффект с зависимостью
  // searchParams срабатывал бы на каждом рендере (новый объект
  // URLSearchParams) и setForm новым объектом зациклил бы рендер.
  // Ориентируемся на СТРОКУ параметров — она меняется только навигацией.
  //
  // Решение по конфликту «URL побеждает»: это deep link, он и задаёт
  // выдачу. Несохранённый набор в форме при переходе по внешней ссылке
  // сбрасывается осознанно. Локальные чипы (даты, цена, теги) URL не
  // трогают, поэтому подмены не происходит — см. set/selectSegment.
  const paramKey = searchParams.toString();
  const [appliedParamKey, setAppliedParamKey] = useState(paramKey);
  if (appliedParamKey !== paramKey) {
    setAppliedParamKey(paramKey);
    const preset = presetFromParams(searchParams);
    setForm(preset);
    setSubmitted(preset);
  }

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
      <Page>
        {/* Фильтр: поверхность — Section, заголовок — нативный.
            Чипы-действия — первой строкой тела (рядом с заголовком
            им не место: header принимает только текст). */}
        <Section header="Поиск попутных поездок">
          <SectionBody>
            <div className={styles.chipRow}>
              <Chip
                variant="quiet"
                Component="a"
                href="#/ride-requests"
                className={styles.chip}
              >
                Ищу попутку
              </Chip>
              <Chip
                variant={showFilters ? "active" : "quiet"}
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
                aria-label="Откуда"
                before={<MapPin size={17} className={INFO} />}
                after={
                  form.fromCity ? (
                    <IconButton
                      type="button"
                      size="s"
                      onClick={() => set("fromCity", "")}
                      aria-label="Очистить откуда"
                    >
                      <X size={14} className={HINT} />
                    </IconButton>
                  ) : undefined
                }
                value={form.fromCity}
                onChange={(event) => set("fromCity", event.target.value)}
                placeholder="Откуда (город или село)"
              />
              <Input
                id="search-to"
                aria-label="Куда"
                before={<MapPin size={17} className={SUCCESS} />}
                after={
                  form.toCity ? (
                    <IconButton
                      type="button"
                      size="s"
                      onClick={() => set("toCity", "")}
                      aria-label="Очистить куда"
                    >
                      <X size={14} className={HINT} />
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
                onClick={swapCities}
                aria-label="Поменять направление"
                className={styles.swap}
              >
                <ArrowRightLeft size={14} className={INFO} />
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
                  <div className={BTN_ROW_WRAP}>
                    {TRIP_TAGS.map((tag) => (
                      <Chip
                        key={tag}
                        tone="accent"
                        variant={
                          form.tags.includes(tag) ? "active" : "quiet"
                        }
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
              before={<SearchIcon size={18} />}
              onClick={submit}
            >
              Найти
            </Button>
          </SectionBody>
        </Section>

        <div className={styles.resultsBar}>
          <Caption weight="2">Найдено поездок: {trips.data?.pages[0]?.pagination.total ?? items.length}</Caption>
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
            <EmptyState
              header={EMPTY_STATES.searchNoResults.header}
              description={EMPTY_STATES.searchNoResults.description}
              action={
                <Button
                  size="m"
                  onClick={reset}
                  disabled={!hasActiveFilters && !form.fromCity && !form.toCity}
                >
                  Сбросить фильтры
                </Button>
              }
            />
          ) : (
            <Stack>
              {items.map((trip) => (
                <TripFeedCard key={trip.id} trip={trip} />
              ))}
              <FetchMore
                hasNextPage={trips.hasNextPage}
                isFetchingNextPage={trips.isFetchingNextPage}
                fetchNextPage={() => void trips.fetchNextPage()}
                sentinelRef={sentinelRef}
                placeholder={
                  <div className={styles.loadingMore}>
                    <div
                      className={`${styles.skeletonLine} ${styles.skeletonLineWide}`}
                    />
                    <div
                      className={`${styles.skeletonLine} ${styles.skeletonLineShort}`}
                    />
                  </div>
                }
                placeholderLabel="Загрузка ещё поездок"
              />
            </Stack>
          )}
        </QueryState>
      </Page>
    </>
  );
}
