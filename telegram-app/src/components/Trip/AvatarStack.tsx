import { Avatar } from "@telegram-apps/telegram-ui";
import type { TripPassenger } from "@edem/contracts";
import styles from "./AvatarStack.module.css";

export interface AvatarStackProps {
  users: TripPassenger[];
  /** Сколько аватаров показать до «+N». */
  max?: number;
  /** Диаметр аватара в px (сетка размеров кита). */
  size?: 20 | 24 | 28 | 40 | 48 | 96;
}

const initials = (name: string) => name.slice(0, 2).toUpperCase();

/**
 * Аватарстак подтверждённых пассажиров для карточки водителя
 * («Вы водитель» — свой рейтинг не нужен). Аватары накладываются
 * внахлёст, лишние прячутся за «+N».
 *
 * a11y: весь стек — один `role="img"` с именами пассажиров одной
 * строкой; отдельные аватары скрыты, чтобы карточка не читалась по
 * буквам. Пустой список не рендерится.
 */
export function AvatarStack({ users, max = 3, size = 28 }: AvatarStackProps) {
  if (users.length === 0) return null;

  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  const names = users.map((user) => user.name).join(", ");

  return (
    <div className={styles.stack} role="img" aria-label={`Пассажиры: ${names}`}>
      {shown.map((user, index) => (
        <span
          key={user.id}
          className={styles.item}
          style={{
            width: size,
            height: size,
            zIndex: shown.length - index,
          }}
          aria-hidden="true"
        >
          <Avatar size={size} src={user.avatar} acronym={initials(user.name)} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className={styles.more}
          style={{ width: size, height: size }}
          aria-hidden="true"
        >
          {`+${rest}`}
        </span>
      )}
    </div>
  );
}
