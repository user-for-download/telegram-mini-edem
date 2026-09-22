import { useId } from "react";
import type { ReactNode } from "react";
import { Headline, VisuallyHidden } from "@telegram-apps/telegram-ui";
import { usePlatform } from "@/hooks/usePlatform";
import styles from "./SheetTitle.module.css";

/**
 * Заголовок bottom-sheet модалки: чинит две проблемы tgui Modal.Header.
 * 1. Modal.Header рендерит текст только на iOS (platform === 'ios'),
 *    на base (Android/desktop) — пустые div (без видимого заголовка).
 * 2. Диалог без имени: Radix Content ставит aria-labelledby только при
 *    наличии Title, tgui Title не рендерит.
 *
 * Решение: скрытый h2 с id на всех платформах (этот же id модалка
 * получает в aria-labelledby) + видимый заголовок только на base
 * (на iOS текст уже есть в Modal.Header, дублировать нельзя).
 *
 * Видимые строки заголовков не меняются — правки тестов не требуют.
 */
export function useSheetTitleId(): string {
  return useId();
}

export function SheetTitle({
  titleId,
  children,
}: {
  /** id из useSheetTitleId(); тот же id — в aria-labelledby модалки. */
  titleId: string;
  children: ReactNode;
}) {
  const platform = usePlatform();
  return (
    <>
      {/* Имя диалога для скринридера — на всех платформах. */}
      <VisuallyHidden Component="h2" id={titleId}>
        {children}
      </VisuallyHidden>
      {platform !== "ios" && (
        <Headline
          Component="p"
          weight="2"
          aria-hidden="true"
          className={styles.title}
        >
          {children}
        </Headline>
      )}
    </>
  );
}
