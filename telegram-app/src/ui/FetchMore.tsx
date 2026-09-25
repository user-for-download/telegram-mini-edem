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
}

/**
 * Единый конец ленты: якорь автодогрузки (нулевой div вне потока —
 * места в покое не занимает) + скелетон во время догрузки + кнопка
 * время догрузки + кнопка «Показать ещё» как fallback и для повторной
 * попытки. Раньше этот блок собирался вручную в 6 экранах, а правило
 * `.sentinel/.fetchMore` копировалось в 4 модулях.
 *
 * Если hasNextPage ложный — рендерит ничего (тот же контракт, что у
 * старых `{hasNextPage && (...)}`, но типобезопасно).
 */
export function FetchMore({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  sentinelRef,
  placeholder,
  placeholderLabel,
  label = "Показать ещё",
}: FetchMoreProps) {
  if (!hasNextPage) return null;
  return (
    <>
      {sentinelRef && (
        <div
          ref={sentinelRef}
          aria-hidden="true"
          className={styles.sentinel}
        />
      )}
      {placeholder && isFetchingNextPage && (
        <div
          role="status"
          aria-label={placeholderLabel ?? "Загрузка ещё записей"}
          className={styles.fetchMorePlaceholder}
        >
          {placeholder}
        </div>
      )}
      <Button
        stretched
        loading={isFetchingNextPage}
        disabled={isFetchingNextPage}
        onClick={() => void fetchNextPage()}
      >
        {label}
      </Button>
    </>
  );
}
