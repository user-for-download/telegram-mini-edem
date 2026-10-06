import { useState, type SubmitEvent } from "react";

import { Button } from "@/ui/Button";
import { Search } from "lucide-react";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import { Card } from "@/ui/Card";
import styles from "./TripSearchSection.module.css";

interface TripSearchSectionProps {
  /** id городов справочника (не имена) — см. CitySelectField. */
  onSearch: (fromCityId?: string, toCityId?: string) => void;
}

/**
 * Поиск поездки карточкой (без заголовка секции — интуитивно):
 * два селекта городов и primary-кнопка, отправка формы по Enter.
 *
 * Состояние — id городов, не имена: селект отдаёт id, и поиск уходит в
 * `fromCityId`/`toCityId`.
 */
export function TripSearchSection({ onSearch }: TripSearchSectionProps) {
  const cities = useAllCitiesQuery();
  const [fromCityId, setFromCityId] = useState("");
  const [toCityId, setToCityId] = useState("");

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault();
    onSearch(fromCityId || undefined, toCityId || undefined);
  };

  return (
    <form onSubmit={submitSearch}>
      <Card variant="flush" className={styles.searchCard}>
        <div className={styles.fields}>
          <CitySelectField
            id="home-from"
            label="Откуда"
            valueId={fromCityId}
            cities={cities.data}
            placeholder="Город или село отправления"
            onChange={setFromCityId}
            excludeId={toCityId}
          />
          <CitySelectField
            id="home-to"
            label="Куда"
            valueId={toCityId}
            cities={cities.data}
            placeholder="Город или село назначения"
            onChange={setToCityId}
            excludeId={fromCityId}
          />
        </div>
        <Button
          className={styles.submit}
          size="l"
          variant="primary"
          stretched
          before={<Search size={18} />}
          type="submit"
        >
          Найти поездку
        </Button>
      </Card>
    </form>
  );
}
