import { useState } from "react";
import { List, TabsList } from "@telegram-apps/telegram-ui";
import { TripActivePage } from "../TripActive/TripActivePage";
import { TripHistoryPage } from "../TripHistory/TripHistoryPage";
import styles from "./TripPage.module.css";

type TripSegment = "active" | "history";

const SEGMENTS: ReadonlyArray<{ value: TripSegment; label: string }> = [
  { value: "active", label: "Активные" },
  { value: "history", label: "История" },
];

export function TripPage() {
  const [segment, setSegment] = useState<TripSegment>("active");

  return (
    <List>
      <TabsList className={styles.tabs}>
        {SEGMENTS.map((option) => (
          <TabsList.Item
            key={option.value}
            selected={segment === option.value}
            onClick={() => setSegment(option.value)}
          >
            {option.label}
          </TabsList.Item>
        ))}
      </TabsList>

      {segment === "active" ? <TripActivePage /> : <TripHistoryPage />}
    </List>
  );
}
