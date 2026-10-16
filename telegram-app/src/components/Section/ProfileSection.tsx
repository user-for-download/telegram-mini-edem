import { Avatar, Skeleton } from "@telegram-apps/telegram-ui";
import { useNavigate } from "react-router-dom";
import { Cell } from "@/ui/Cell";
import { haptic } from "@/utils/haptics";
import { RatingPill } from "@/components/RatingPill";
import { useProfileQuery } from "@/queries/profile";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import styles from "./ProfileSection.module.css";

/** Профиль-бар главной: аватар, имя, счётчик поездок и пилюля рейтинга. Тап — в профиль. */
export function ProfileSection() {
  const navigate = useNavigate();
  const profile = useProfileQuery();
  // Без условия пульсация гасилась ВСЕГДА, в том числе у тех, кто её не
  // просил отключать. Теперь поведение совпадает с остальными болванками
  // (components/Skeletons.tsx): анимация есть по умолчанию, гасится по
  // системной настройке (WCAG 2.3.3).
  const reduceMotion = usePrefersReducedMotion();

  return (
    <Skeleton visible={profile.isLoading} withoutAnimation={reduceMotion}>
      <Cell
        Component="button"
        type="button"
        className={styles.cell}
        onClick={() => {
          haptic.light();
          navigate("/profile");
        }}
        after={<RatingPill
          size="m"
          value={profile.data?.rating ?? null}
          reviewsCount={profile.data?.reviewsCount ?? null}
        />}
        before={
          <Avatar
            size={48}
            src={profile.data?.avatar}
            acronym={(profile.data?.name ?? "ЕД").slice(0, 2).toUpperCase()}
          />
        }
        aria-label="Открыть профиль"
      >
        <span className={styles.who}>
          <span className={styles.name}>
            {profile.data?.name ?? "Попутчик"}
          </span>
          <span className={styles.trips}>
            {`поездок: ${profile.data?.tripsCount ?? 0}`}
          </span>
        </span>
      </Cell>
    </Skeleton>
  );
}
