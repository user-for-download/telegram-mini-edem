import { Caption, Headline } from "@telegram-apps/telegram-ui";

/**
 * Единый заголовок блока-контента (стандарт приложения): заголовок слева,
 * подсказка справа. Используется там, где tgui Section не подходит
 * (карточки форм, сетки — Section только для строк). Типографика tgui
 * вместо самописных text-[Npx]-спанов.
 */
export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <Headline weight="2">{title}</Headline>
      {hint && (
        <Caption className="shrink-0 text-(--tgui--hint_color)">
          {hint}
        </Caption>
      )}
    </div>
  );
}
