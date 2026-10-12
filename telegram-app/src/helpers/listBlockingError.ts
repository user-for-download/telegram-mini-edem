/**
 * Ошибка, из-за которой список не показывать ВООБЩЕ.
 *
 * React Query держит `data` при ошибке, но переключает `status` в `error`.
 * `QueryState` проверяет `error` раньше `children`, поэтому у ленты со
 * догруженными страницами сбой ОДНОЙ следующей страницы выкидывал на экран
 * «Ошибка загрузки» уже прочитанные карточки вместе с формой поиска.
 *
 * Разница принципиальна: первая страница не пришла — показывать нечего,
 * звать пользователя ждать; следующая не пришла — показывать есть что,
 * предложить «Повторить» внизу.
 */

/** Минимальный срез результата useInfiniteQuery. */
interface InfiniteQueryLike {
  error: unknown;
  data: { pages: unknown[] } | undefined;
}

/**
 * Что отдать в `error` у `<QueryState>` для бесконечной ленты.
 *
 * `null`, если данные уже есть: контент отрисуется, а сбой догрузки
 * сообщается отдельной плашкой (`FetchMore`/`Notice`), чтобы не терять
 * уже прочитанное.
 */
export function listBlockingError(query: InfiniteQueryLike): unknown {
  const hasPages = (query.data?.pages?.length ?? 0) > 0;
  return hasPages ? null : query.error;
}
