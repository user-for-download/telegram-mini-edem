import { PageHeader } from "@/components/PageHeader";
import { ReviewsBody, type ReviewsTab } from "@/components/ReviewsModal";

export type { ReviewsTab };

/**
 * Легаси-обёртка: page-роут /reviews заменён route-backed ReviewsRoute
 * (AppRouter) — тело живёт в ReviewsModal.ReviewsBody без PageHeader.
 * Оставлено для совместимости (тесты, прямые импорты).
 */
export function ReviewsPage({ initialTab = "mine" }: { initialTab?: ReviewsTab }) {
  return (
    <>
      <PageHeader title="Отзывы" />
      <ReviewsBody initialTab={initialTab} />
    </>
  );
}
