import { useState, type SubmitEvent } from "react";
import { Button, Card } from "@telegram-apps/telegram-ui";
import { Search } from "lucide-react";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";
import { useAllCitiesQuery } from "@/queries/useAllCities";
import styles from "./TripSearchSection.module.css";

interface TripSearchSectionProps {
  onSearch: (from?: string, to?: string) => void;
}

/**
 * Поиск поездки карточкой (без заголовка секции — интуитивно):
 * два селекта городов и primary-кнопка, отправка формы по Enter.
 */
export function TripSearchSection({ onSearch }: TripSearchSectionProps) {
  const cities = useAllCitiesQuery();
  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault();
    onSearch(fromCity || undefined, toCity || undefined);
  };

  return (
    <form onSubmit={submitSearch}>
      <Card type="plain" className={styles.searchCard}>
        <div className={styles.fields}>
          <CitySelectField
            id="home-from"
            label="Откуда"
            value={fromCity}
            cities={cities.data}
            placeholder="Город или село отправления"
            onSelect={setFromCity}
            exclude={toCity}
          />
          <CitySelectField
            id="home-to"
            label="Куда"
            value={toCity}
            cities={cities.data}
            placeholder="Город или село назначения"
            onSelect={setToCity}
            exclude={fromCity}
          />
        </div>
        <Button
          className={styles.submit}
          size="l"
          mode="filled"
          stretched
          before={<Search size={18} />}
          type="submit"
        >
          Найти поездку
        </Button>
        <div className={styles.hint}>
          Достаточно заполнить хотя бы один город
        </div>
      </Card>
    </form>
  );
}
