import { Caption, Text } from "@telegram-apps/telegram-ui";
import { Sheet } from "@/ui/Sheet";
import { QueryState } from "@/components/QueryState";
import { Stack } from "@/ui/Stack";
import { useUserQuery } from "@/queries/profile";
import { useModalBack } from "@/utils/modalBack";
import { ProfileHero } from "./ProfileHero";
import type { UserProfileTarget } from "./UserProfileProvider";
import styles from "./UserProfileSheet.module.css";

/**
 * Шторка профиля другого человека (водитель, пассажир, автор отзыва).
 *
 * Одна шторка на приложение — экземпляр рендерит провайдер и держит
 * `target`. Кто открыл — неважно, важно лишь содержимое: тот же ProfileHero,
 * что и у своего профиля (общий компонент), плюс «О себе» и автомобиль.
 *
 * Телефона здесь нет по существу, а не по забывчивости: публичный ответ
 * (serializePublicUser) его не содержит — телефон отдаётся только
 * владельцу и подтверждённой стороне деталей поездки. Поэтому шапка шторки
 * рендерится без phone — и не выдумывает его, даже если в initial он есть.
 */
export function UserProfileSheet({
  target,
  onClose,
}: {
  target: UserProfileTarget | null;
  onClose: () => void;
}) {
  const open = target !== null;
  // Нативная кнопка «Назад» закрывает шторку, а не уводит с экрана:
  // без этой подписки Back ушёл бы по истории вместе с экраном.
  useModalBack(onClose, open);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={target?.initial?.name ?? "Профиль"}
    >
      {target ? <UserProfileBody target={target} /> : null}
    </Sheet>
  );
}

function UserProfileBody({ target }: { target: UserProfileTarget }) {
  const user = useUserQuery(target.id);
  // Пока идёт догрузка, рисуем то, что вызывающий уже знает (initial):
  // карточка не мигает пустотой, если данные уже были на руках.
  const shown = user.data ?? target.initial;

  return (
    <QueryState
      loading={user.isLoading && !shown}
      error={user.error}
      empty={!shown}
      emptyText="Не удалось загрузить профиль"
      onRetry={() => void user.refetch()}
    >
      {shown ? (
        <Stack>
          <ProfileHero user={shown} />
          {shown.about ? (
            <div className={styles.about}>
              <Caption className={styles.aboutLabel}>О себе</Caption>
              <Text>{shown.about}</Text>
            </div>
          ) : null}
          {shown.car ? (
            <div className={styles.car}>
              <Text weight="2">
                {`${shown.car.model} · ${shown.car.color}`}
              </Text>
            </div>
          ) : null}
        </Stack>
      ) : null}
    </QueryState>
  );
}
