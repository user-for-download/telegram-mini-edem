import { Notice } from "@/ui/Notice";

/**
 * Ошибка мутации: пустой рендер без ошибки, role="alert" — канон для
 * «внезапно не получилось» (тот же рецепт, что FieldError, но с unknown).
 */
export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error ? error.message : "Не удалось выполнить действие";
  return (
    <Notice tone="danger" variant="text">
      {message}
    </Notice>
  );
}
