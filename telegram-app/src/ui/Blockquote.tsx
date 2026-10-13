import { Blockquote as TguiBlockquote } from "@telegram-apps/telegram-ui";
import type { ComponentProps, ReactNode } from "react";

import styles from "./ui.module.css";

/**
 * Единая плашка «чужие слова» — свободный текст, написанный человеком:
 * текст жалобы, ответ модерации, «О себе» в профиле.
 *
 * Кит-аналог `Blockquote` (2.1.13) даёт фон, левую полосу и иконку кавычки,
 * и всё, что нужно сверху. Обёртка существует ради двух общих правил,
 * которые иначе пришлось бы повторять в каждом потребителе:
 *
 * 1. **СВОБОДНЫЙ ТЕКСТ НЕ СХЛОПЫВАЕТСЯ.** `pre-wrap` + `overflow-wrap` —
 *    иначе переносы, набранные человеком, склеились бы в кашу, а длинное
 *    слово без пробела (URL, имя файла) вылезло бы за плашку. Правило
 *    общее для всех мест, где текст писал человек, а не выбирал из списка.
 * 2. **Тон по смыслу, а не всегда синий.** Китовская полоса всегда
 *    `link_color`; ответ модерации «жалоба отклонена» отличается от
 *    «нарушений не найдено» — и полоса должна это показывать. Цвета берём
 *    из тех же `--app-*`, что и `Notice` (тот же набор токенов, та же
 *    инверсия светлая/тёмная в index.css).
 *
 * `type="other"` намеренно: китовский `type="text"` оборачивает содержимое
 * в `Subheadline` — то есть навязывает кегль всем потомкам, включая вложенную
 * разметку. Мы контролируем типографику сами (обычно `Text`/`Caption`
 * внутри), поэтому содержимое рендерится как есть.
 *
 * КЛАСС ОБЯЗАТЕЛЕН (как у `Field`/`Card`): без него правила выше мертвы, а
 * кит по умолчанию даст серый блок без переносов. Пины:
 * `ui/__tests__/blockquote.test.tsx` (класс в DOM) и потребители.
 */
export interface BlockquoteProps extends Omit<
  ComponentProps<typeof TguiBlockquote>,
  "type"
> {
  /** Полоса слева по смыслу текста. По умолчанию — нейтральный `link`. */
  tone?: "info" | "success" | "danger" | "warning";
  children?: ReactNode;
}

export function Blockquote({
  tone,
  className,
  children,
  ...rest
}: BlockquoteProps) {
  const merged = [styles.quote, className].filter(Boolean).join(" ");
  return (
    <TguiBlockquote type="other" data-tone={tone} className={merged} {...rest}>
      {children}
    </TguiBlockquote>
  );
}
