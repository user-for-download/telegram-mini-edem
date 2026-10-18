import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Loading } from "@/ui/Loading";

/** Состояния запроса: loading (скелетон списка или спиннер),
 *  error с retry, empty, контент.
 *
 * Тонкая композиция над ui-китом (U1): error и empty — через `EmptyState`
 * (он один владеет разметкой Placeholder + кнопки действия), loading —
 * скелетон из Skeletons.tsx либо спиннер. Своей разметки и словаря здесь
 * нет: тексты error/empty — записи `EMPTY_STATES.loadError/genericEmpty`
 * (заголовок empty — `genericEmpty.header`, описание — `emptyText`
 * экрана), кнопка retry — всегда `ui/Button size="m"` через слот `action`
 * (до U1 кнопка лежала в `children` Placeholder — это слот визуала,
 * а не действия).
 *
 * `variant="primary"` у retry: на экране ошибки это ЕДИНСТВЕННОЕ действие,
 * то есть главное (реестр #6). Без варианта кнопка была secondary —
 * «Повторить» на ошибке списка выглядело приглушённым, а то же «Повторить»
 * на терминальном экране (`AccountStatePage.RetryAction`) — залитым.
 */
export function QueryState({
  loading,
  error,
  empty,
  emptyText,
  emptyHeader,
  emptyAction,
  skeleton,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
  /** Заголовок empty-ветки; по умолчанию `genericEmpty.header`. */
  emptyHeader?: string;
  /** Действие под пустым состоянием (например, ссылка на историю). */
  emptyAction?: React.ReactNode;
  /** Скелетон tgui Skeleton для списков; без него — Spinner. */
  skeleton?: React.ReactNode;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    if (skeleton) return <>{skeleton}</>;
    return <Loading />;
  }
  if (error) {
    return (
      <EmptyState
        header={EMPTY_STATES.loadError.header}
        description={EMPTY_STATES.loadError.description}
        action={
          <Button size="m" variant="primary" onClick={onRetry}>
            Повторить
          </Button>
        }
      />
    );
  }
  if (empty)
    return (
      <EmptyState
        header={emptyHeader ?? EMPTY_STATES.genericEmpty.header}
        description={emptyText}
        action={emptyAction}
      />
    );
  return <>{children}</>;
}
