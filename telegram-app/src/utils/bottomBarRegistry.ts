/**
 * Действие контекстного нижнего бара: одна большая кнопка вместо табов
 * (страница «Создание поездки» регистрирует submit, Shell рисует кнопку).
 */
export interface BottomBarAction {
  label: string;
  onSubmit: () => void;
  loading: boolean;
  disabled: boolean;
}

type Listener = () => void;

const stack: BottomBarAction[] = [];
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

/**
 * Регистрация действия в нижнем баре (стек, паттерн modalBack): активна
 * последняя регистрация. Возвращает функцию снятия; её повторный вызов —
 * безопасный no-op.
 */
export function register(action: BottomBarAction): () => void {
  stack.push(action);
  notify();
  return () => {
    const index = stack.lastIndexOf(action);
    if (index < 0) return;
    stack.splice(index, 1);
    notify();
  };
}

/** Активное действие бара (последняя регистрация) или null — обычные табы. */
export function getCurrent(): BottomBarAction | null {
  return stack[stack.length - 1] ?? null;
}

/** Подписка Shell на смену активного действия (под useSyncExternalStore). */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
