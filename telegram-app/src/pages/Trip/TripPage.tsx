import { Navigate, useSearchParams } from "react-router-dom";
import { Page } from "@/ui/Page";
import { TripActivePage } from "../TripActive/TripActivePage";

/**
 * «Поездки» — только активные (табов больше нет). История живёт
 * отдельной страницей /profile/history (пункт меню профиля).
 * ?segment=history — совместимость со старыми ссылками и закэшированным
 * клиентом: ведём на новую страницу вместо молчаливого игнора.
 */
export function TripPage() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("segment") === "history") {
    return <Navigate to="/profile/history" replace />;
  }
  return (
    <Page>
      <TripActivePage />
    </Page>
  );
}
