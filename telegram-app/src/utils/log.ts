// DEV-gated debug logger: silent in prod, console.log in dev.
// Прецедент флага: import.meta.env.DEV (router/deepLinks.ts).
export function log(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
}
