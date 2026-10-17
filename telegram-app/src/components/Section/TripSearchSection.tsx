import { useState, type SubmitEvent } from "react";

import { Button } from "@/ui/Button";
import { Search } from "lucide-react";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";
import { QueryState } from "@/components/QueryState";
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
 *
 * Справочник обязателен ДО отрисовки полей: пока `cities.data` нет, селекты
 * пустые, и кнопка отдавала бы поиск без маршрута (неотфильтрованную
 * выдачу) — то есть человек вводил фильтр, которого не применили. То же
 * касается ошибки сети: она НЕ ошибка валидации, поэтому терминальный
 * `QueryState` с «Повторить», а не пустые поля (MEMORY.md:487, тот же
 * приём в CreateTripPage).
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
        <QueryState
          loading={cities.isLoading}
          error={cities.error}
          empty={false}
          emptyText=""
          onRetry={() => void cities.refetch()}
        >
          <div className={styles.fields}>
            <CitySelectField
              id="home-from"
              label="Откуда"
              valueId={fromCityId}
              cities={cities.data}
              placeholder="Город или село отправления"
              onChange={setFromCityId}
              excludeId={toCityId}
              compact
            />
            <CitySelectField
              id="home-to"
              label="Куда"
              valueId={toCityId}
              cities={cities.data}
              placeholder="Город или село назначения"
              onChange={setToCityId}
              excludeId={fromCityId}
              compact
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
        </QueryState>
      </Card>
    </form>
  );
}
