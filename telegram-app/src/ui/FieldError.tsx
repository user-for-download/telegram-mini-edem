import { Notice } from "@/ui/Notice";

export interface FieldErrorProps {
  /** Пустая строка / undefined → пустой рендер (паттерн MutationError). */
  error?: string | null;
  /** id плашки: для aria-describedby у поля формы (Field ставит сам). */
  id?: string;
  /** Дополнительный класс (отступы/ритм у потребителя). */
  className?: string;
}

/** Ошибка поля формы: красная строка role="alert"; при отсутствии — ничего. */
export function FieldError({ error, id, className }: FieldErrorProps) {
  if (!error) return null;
  return (
    <Notice tone="danger" variant="text" id={id} className={className}>
      {error}
    </Notice>
  );
}
