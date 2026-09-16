import { Caption } from "@telegram-apps/telegram-ui";

export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error ? error.message : "Не удалось выполнить действие";
  return (
    <Caption
      Component="p"
      role="alert"
      className="text-(--tg-theme-destructive-text-color)"
    >
      {message}
    </Caption>
  );
}
