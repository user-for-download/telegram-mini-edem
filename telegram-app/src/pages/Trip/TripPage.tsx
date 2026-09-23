import { useSearchParams } from "react-router-dom";
import { TabsList } from "@telegram-apps/telegram-ui";
import { haptic } from "@/utils/haptics";
import { Page } from "@/ui/Page";
import { TripActivePage } from "../TripActive/TripActivePage";
import { TripHistoryPage } from "../TripHistory/TripHistoryPage";
import styles from "./TripPage.module.css";

type TripSegment = "active" | "history";

const SEGMENTS: ReadonlyArray<{ value: TripSegment; label: string }> = [
  { value: "active", label: "Активные" },
  { value: "history", label: "История" },
];

function parseSegment(value: string | null): TripSegment {
  return value === "history" ? "history" : "active";
}

export function TripPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const segment = parseSegment(searchParams.get("segment"));

  const pickSegment = (next: TripSegment) => {
    if (next === segment) return;
    haptic.selection();
    setSearchParams(next === "active" ? {} : { segment: next }, {
      replace: true,
    });
  };

  return (
    <Page>
      <TabsList className={styles.tabs}>
        {SEGMENTS.map((option) => (
          <TabsList.Item
            key={option.value}
            selected={segment === option.value}
            onClick={() => pickSegment(option.value)}
          >
            {option.label}
          </TabsList.Item>
        ))}
      </TabsList>

      {segment === "active" ? <TripActivePage /> : <TripHistoryPage />}
    </Page>
  );
}
