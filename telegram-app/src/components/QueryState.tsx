import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";


/** Состояния запроса: loading (скелетон списка или спиннер),
 *  error с retry, empty, контент. */
export function QueryState({
  loading,
  error,
  empty,
  emptyText,
  emptyAction,
  skeleton,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
  /** Действие под пустым состоянием (например, ссылка на историю). */
  emptyAction?: React.ReactNode;
  /** Скелетон tgui Skeleton для списков; без него — Spinner. */
  skeleton?: React.ReactNode;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <>
        {skeleton ?? (
          <Placeholder>
            <span role="status" aria-label="Загрузка">
              <Spinner size="m" />
            </span>
          </Placeholder>
        )}
      </>
    );
  if (error) {
    return (
      <Placeholder
        header="Не удалось загрузить данные"
        description="Проверьте соединение и повторите попытку."
      >
        <Button size="m" onClick={onRetry}>
          Повторить
        </Button>
      </Placeholder>
    );
  }
  if (empty)
    return (
      <Placeholder header="Пока пусто" description={emptyText}>
        {emptyAction}
      </Placeholder>
    );
  return <>{children}</>;
}
