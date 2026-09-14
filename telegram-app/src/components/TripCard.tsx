import {
  Baby,
  Cigarette,
  CigaretteOff,
  Luggage,
  PawPrint,
  ShieldCheck,
  Star,
  VolumeX,
} from "lucide-react";
import type { Trip, TripTag } from "@edem/contracts";
import { useNavigate } from "react-router-dom";
import { Tappable } from "@telegram-apps/telegram-ui";
import { dayLabel, formatArrivalTime, formatDuration } from "@/utils/date";
import { haptic } from "@/utils/haptics";
import { LazyAvatar } from "@/components/LazyAvatar";

/** Иконки для очевидных тегов (язык примера); остальные теги не
 *  иконизируем — их видно в деталях поездки. */
const TAG_ICONS: Partial<Record<TripTag, { Icon: typeof Luggage }>> = {
  "Можно с животными": { Icon: PawPrint },
  "Есть багаж": { Icon: Luggage },
  "Не курить": { Icon: CigaretteOff },
  "Можно курить": { Icon: Cigarette },
  "Можно с детьми": { Icon: Baby },
  "Тихая поездка": { Icon: VolumeX },
};

/**
 * Карточка поездки в ленте поиска — язык SearchTab эталона
 * (/tmp/edem---telegram-mini-app): вся карточка кликабельна
 * (нативный button, без отдельной кнопки «Подробнее»),
 * время → прибытие, маршрут + цена, адреса, водитель,
 * компактная цветная пилюля мест и иконки тегов.
 */
export function TripCard({ trip }: { trip: Trip }) {
  const navigate = useNavigate();
  const fewSeats = trip.seatsAvailable <= 1;
  const duration = formatDuration(trip.durationMinutes);
  const arrival = formatArrivalTime(trip.time, trip.durationMinutes);

  return (
    <Tappable
      Component="button"
      type="button"
      onClick={() => {
        haptic.light();
        navigate(`/trips/${trip.id}`);
      }}
      className="text-left p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] hover:border-[var(--app-info)] shadow-xs cursor-pointer transition flex flex-col gap-3 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-bold text-[var(--tgui--text_color)]">
              {trip.time}
            </span>
            {duration && (
              <span className="text-xs text-[var(--tgui--hint_color)]">({duration})</span>
            )}
            {arrival && (
              <span className="text-[15px] font-medium text-[var(--tgui--hint_color)]">
                → {arrival}
              </span>
            )}
          </div>
          <div className="text-[14px] font-semibold text-[var(--tgui--text_color)] mt-0.5 truncate">
            {trip.fromCity} → {trip.toCity}
          </div>
          <div className="text-[12px] text-[var(--tgui--hint_color)]">
            {dayLabel(trip.date)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[16px] font-bold text-[var(--tgui--text_color)]">
            {trip.price} ₽
          </div>
          <span className="text-[11px] text-[var(--tgui--hint_color)]">за место</span>
        </div>
      </div>

      {(trip.fromAddress || trip.toAddress) && (
        <div className="text-[12px] text-[var(--tgui--hint_color)] flex flex-col gap-0.5 border-l-2 border-[var(--tgui--outline)] pl-2.5">
          {trip.fromAddress && (
            <div className="truncate">Посадка: {trip.fromAddress}</div>
          )}
          {trip.toAddress && <div className="truncate">Высадка: {trip.toAddress}</div>}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--tgui--outline)]">
        <div className="flex items-center gap-2 min-w-0">
          <LazyAvatar
            size={40}
            src={trip.driver.avatar}
            acronym={trip.driver.name.slice(0, 1).toUpperCase()}
            alt={trip.driver.name}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[13px] font-medium text-[var(--tgui--text_color)]">
              <span className="truncate">{trip.driver.name}</span>
              {trip.driver.isVerified && (
                <ShieldCheck
                  size={14}
                  className="text-[var(--app-info)] fill-[var(--app-info-bg)] shrink-0"
                />
              )}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-[var(--tgui--hint_color)]">
              <Star size={11} className="fill-[var(--app-rating)] text-[var(--app-rating)]" />
              <span>{trip.driver.rating.toFixed(1)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full ${
              trip.seatsAvailable === 0
                ? "font-semibold bg-[var(--app-danger-bg)] text-[var(--app-danger)]"
                : fewSeats
                  ? "font-semibold bg-[var(--app-warning-bg)] text-[var(--app-warning)]"
                  : "font-medium bg-[var(--app-success-bg)] text-[var(--app-success)]"
            }`}
          >
            {trip.seatsAvailable === 0
              ? "Мест нет"
              : `Осталось мест: ${trip.seatsAvailable}`}
          </span>
          {trip.tags.length > 0 && (
            <div className="flex items-center gap-1.5 text-[var(--tgui--hint_color)]">
              {trip.tags.flatMap((tag) => {
                const entry = TAG_ICONS[tag];
                return entry ? [<entry.Icon key={tag} size={13} />] : [];
              })}
            </div>
          )}
        </div>
      </div>
    </Tappable>
  );
}
