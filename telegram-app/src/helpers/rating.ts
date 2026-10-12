/**
 * Есть ли у пользователя оценка вообще.
 *
 * Контракт отдаёт `rating` обязательным (`userSchema`: `z.number().min(0).max(5)`),
 * поэтому «рейтинга нет» приходит ЧИСЛОМ, а не null:
 *   - 5.0 — новый пользователь: `auth/index.ts` создаёт rating: 5 при
 *     reviewsCount 0. Без проверки свежий аккаунт светился бы идеальной
 *     оценкой, будто его хвалили, а отзывов ноль.
 *   - 0.0 — `recomputeUserRating` пишет 0, когда опубликованных отзывов не
 *     осталось (например, админ удалил последний).
 *
 * Правило «оценка есть только при отзывах» держим здесь, а не по месту:
 * пилюля, профиль и страница отзывов обязаны показывать одно и то же.
 *
 * `reviewsCount === null/undefined` означает «не знаем» — тогда доверяем
 * значению и не гасим оценку: иначе сломалось бы отображение у видов без
 * счётчика отзывов.
 */
export function hasRating(
  rating: number | null | undefined,
  reviewsCount: number | null | undefined,
): boolean {
  if (rating == null || !Number.isFinite(rating)) return false;
  if (reviewsCount == null) return true;
  return reviewsCount > 0;
}

/** «4.9» для показа, «—» когда оценки нет (не 0.0 и не мнимое 5.0). */
export function formatRating(
  rating: number | null | undefined,
  reviewsCount: number | null | undefined,
): string {
  if (!hasRating(rating, reviewsCount)) return "—";
  return Math.min(5, Math.max(0, rating as number)).toFixed(1);
}
