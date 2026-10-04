import { Notice } from "@/ui/Notice";

/**
 * Ошибка мутации: пустой рендер без ошибки, role="alert" — канон для
 * «внезапно не получилось» (тот же рецепт, что FieldError, но с unknown).
 */
export function MutationError({
  error,
  fallback = "Не удалось выполнить действие",
}: {
  error: unknown;
  /** Текст, когда ошибка не Error (специфичнее дефолта). */
  fallback?: string;
}) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : fallback;
  return (
    <Notice tone="danger" variant="text">
      {message}
    </Notice>
  );
}
