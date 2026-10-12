import type { ReactNode, RefObject } from "react";
import { Button } from "@/ui/Button";
import styles from "./ui.module.css";

export interface FetchMoreProps {
  /** Есть ли ещё страницы (hasNextPage из useInfiniteQuery). */
  hasNextPage: boolean | undefined;
  /** Идёт ли догрузка (isFetchingNextPage из useInfiniteQuery). */
  isFetchingNextPage: boolean;
  /** Догрузить следующую страницу (fetchNextPage из useInfiniteQuery). */
  fetchNextPage: () => void | Promise<unknown>;
  /**
   * Якорь автодогрузки (ref от useInfiniteSentinel). Без него — только
   * кнопка «Показать ещё» (например, модалки без автодогрузки).
   */
  sentinelRef?: RefObject<HTMLDivElement | null>;
  /** Скелетон-плейсхолдер, видимый пока идёт догрузка. */
  placeholder?: ReactNode;
  /** aria-label у role="status" (только вместе с placeholder). */
  placeholderLabel?: string;
  /** Текст кнопки. */
  label?: string;
  /**
   * Ошибка догрузки. `hasNextPage` после сбоя остаётся истинным, поэтому без
   * этого кнопка выглядит как обычное «Показать ещё» и не даёт понять, что
   * страница не загрузилась. Рендерим внятный текст и aria-live: страницы
   * обычно цепляются автодогрузкой, то есть без объявления об ошибке её
   * заметят только прокрутив вниз.
   */
  error?: unknown;
}

/**
 * Единый конец ленты: якорь автодогрузки (нулевой div вне потока —
 * места в покое не занимает) + скелетон во время догрузки + кнопка
 * «Показать ещё» как fallback и для повторной попытки.
 *
 * Если hasNextPage ложный — рендерит ничего.
 */
export function FetchMore({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  sentinelRef,
  placeholder,
  placeholderLabel,
  label = "Показать ещё",
  error,
}: FetchMoreProps) {
  if (!hasNextPage) return null;
  return (
    <>
      {sentinelRef ? (
        <div
          ref={sentinelRef}
          aria-hidden="true"
          className={styles.sentinel}
        />
      ) : null}
      {placeholder && isFetchingNextPage ? (
        <div
          role="status"
          aria-label={placeholderLabel ?? "Загрузка ещё записей"}
          className={styles.fetchMorePlaceholder}
        >
          {placeholder}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={styles.fetchMoreError}>
          Не удалось загрузить ещё. Попробуйте ещё раз.
        </p>
      ) : null}
      <Button
        stretched
        loading={isFetchingNextPage}
        disabled={isFetchingNextPage}
        onClick={() => void fetchNextPage()}
      >
        {error ? "Повторить загрузку" : label}
      </Button>
    </>
  );
}
