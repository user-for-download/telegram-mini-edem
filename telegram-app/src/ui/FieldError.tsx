import { Notice } from "@/ui/Notice";

export interface FieldErrorProps {
  /** Пустая строка / undefined → пустой рендер (паттерн MutationError). */
  error?: string | null;
  /** id плашки: для aria-describedby у поля формы (link снаружи). */
  id?: string;
}

/** Ошибка поля формы: красная строка role="alert"; при отсутствии — ничего. */
export function FieldError({ error, id }: FieldErrorProps) {
  if (!error) return null;
  return (
    <Notice tone="danger" variant="text" id={id}>
      {error}
    </Notice>
  );
}
