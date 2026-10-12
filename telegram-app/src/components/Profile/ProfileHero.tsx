import type { ReactNode } from "react";
import { Avatar, Caption, Headline } from "@telegram-apps/telegram-ui";
import { ShieldCheck } from "lucide-react";
import { RatingPill } from "@/components/RatingPill";
import { plural } from "@/utils/plural";
import styles from "./ProfileHero.module.css";

/** Всё, что шапке нужно знать о человеке. Общий тип для «себя» и «другого»:
 *  в обоих случаях это User из контракта, различается только набор
 *  дополнительных пропсов ниже. */
export interface ProfileHeroUser {
  name: string;
  avatar?: string | null;
  /** 0…5; вместе с reviewsCount определяет, есть рейтинг или нет. */
  rating: number;
  reviewsCount: number;
  tripsCount: number;
  /** Галочка верификации — рисуется щитом рядом с именем. */
  isVerified?: boolean;
}

export interface ProfileHeroProps {
  user: ProfileHeroUser;
  /**
   * Телефон — только СВОЙ профиль: у чужого сервер его не отдаёт
   * (serializePublicUser), а положить его в шторку значило бы выдумать
   * данные. Отсутствие = не рисуем.
   */
  phone?: string | null;
  /**
   * Слот под действие под шапкой: у себя — кнопка «Редактировать
   * профиль», у другого человека — пусто. Компонент не знает, что там
   * и куда ведёт: это решение вызывающего.
   */
  action?: ReactNode;
  /**
   * Диаметр аватара: 96 в витрине профиля, меньше — когда шапка стоит
   * в тесном контейсте.
   */
  avatarSize?: 48 | 96;
}

/**
 * Шапка профиля — центрированная витрина: аватар, имя, телефон, строка
 * метрик «поездок · рейтинг · отзывов» и слот действия.
 *
 * Общий компонент для СЕБЯ (ProfilePage: телефон + кнопка правки) и
 * для ДРУГОГО человека (шторка профиля: ни телефона, ни кнопки). Разница
 * только в пропах — раскладка и типографика общие, иначе «свой профиль»
 * и «профиль соседа» со временем разъедутся набором правок.
 *
 * Рейтинг идёт пилюлей RatingPill и без отзывов показывает прочерк
 * (hasRating), поэтому число рядом обязано быть с правильным
 * склонением — иначе «0 отзывов» читается как ошибка подписи.
 */
export function ProfileHero({
  user,
  phone,
  action,
  avatarSize = 96,
}: ProfileHeroProps) {
  return (
    <div className={styles.hero}>
      <Avatar
        size={avatarSize}
        src={user.avatar ?? undefined}
        acronym={user.name.slice(0, 2).toUpperCase()}
      />
      <Headline weight="2" className={styles.heroName}>
        {user.name}
        {user.isVerified && (
          <ShieldCheck
            size={18}
            className={styles.verified}
            aria-label="Верифицирован"
          />
        )}
      </Headline>
      {phone ? <Caption className={styles.heroPhone}>{phone}</Caption> : null}
      <div className={styles.heroMeta}>
        <Caption>{`поездок: ${user.tripsCount}`}</Caption>
        <Caption aria-hidden="true">·</Caption>
        <RatingPill value={user.rating} reviewsCount={user.reviewsCount} />
        <Caption>{`${user.reviewsCount} ${plural(
          user.reviewsCount,
          "отзыв",
          "отзыва",
          "отзывов",
        )}`}</Caption>
      </div>
      {action}
    </div>
  );
}
