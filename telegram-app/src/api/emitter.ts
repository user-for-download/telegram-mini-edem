/**
 * Типизированный мини-эмиттер для подписок вида on/emit.
 *
 * Ошибка в одном слушателе изолируется (остальные всё равно вызываются)
 * и уходит в `console.error`.
 */
export class MiniEmitter<Events extends Record<string, unknown[]>> {
  private readonly sets = new Map<keyof Events, Set<(...args: never[]) => void>>();

  constructor(private readonly label = "emitter") {}

  on<E extends keyof Events>(event: E, listener: (...args: Events[E]) => void): () => void {
    let set = this.sets.get(event);
    if (!set) {
      set = new Set();
      this.sets.set(event, set);
    }
    set.add(listener as unknown as (...args: never[]) => void);
    return () => {
      this.off(event, listener);
    };
  }

  off<E extends keyof Events>(event: E, listener: (...args: Events[E]) => void): void {
    this.sets.get(event)?.delete(listener as unknown as (...args: never[]) => void);
  }

  emit<E extends keyof Events>(event: E, ...args: Events[E]): void {
    this.sets.get(event)?.forEach((listener) => {
      try {
        (listener as unknown as (...args: Events[E]) => void)(...args);
      } catch (err) {
        console.error(`[${this.label}] ${String(event)} listener error:`, err);
      }
    });
  }
}
