import { Caption, Text } from "@telegram-apps/telegram-ui";
import { useEffect, useState } from "react";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { QueryState } from "@/components/QueryState";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { MutationError } from "@/components/MutationError";
import { useToast } from "@/components/Toast/ToastProvider";
import { Stack } from "@/ui/Stack";
import { Blockquote } from "@/ui/Blockquote";
import { useUserQuery } from "@/queries/profile";
import {
  useBlockStatusQuery,
  useBlockUserMutation,
  useUnblockUserMutation,
} from "@/queries/useBlocksQuery";
import { useModalBack } from "@/utils/modalBack";
import { haptic } from "@/utils/haptics";
import { MIN_TARGET } from "@/ui/classes";
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
 *
 * Запрос живёт ЗДЕСЬ, а не в теле: заголовок шторки (имя + aria-labelledby)
 * обязан отражать догруженные данные, а не застывший initial (M2 аудита).
 * При открытии только по id заголовок сначала «Профиль», затем имя.
 *
 * Ошибка НЕ затирает показанный initial (M1 аудита): initial пришёл с
 * экрана, который пользователь только что видел, — показывать вместо него
 * полноэкранный loadError из-за фонового 429/500 значило бы отбирать
 * данные, которые уже на руках. Ветка ошибки — только когда показать
 * нечего (нет ни initial, ни данных).
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
  // Последний target живёт до размонтирования: при закрытии target
  // становится null, а Modal ещё играет анимацию — контент, зануленный
  // вместе с target, мигнул бы пустотой. Удержание даёт шторке
  // закрыться поверх прежнего содержимого.
  //
  // Именно СОСТОЯНИЕ, а не ref: чтение ref во время рендера запрещено
  // правилом react-hooks/refs (такой вариант ловил линт). Обновление
  // состояния на рендере разрешено React для собственного состояния
  // компонента, когда props изменились («You Might Not Need an Effect»),
  // и сравнение по идентичности не даёт лишнего цикла: следующий target
  // приходит лишь по клику.
  const [retained, setRetained] = useState(target);
  if (target !== null && target !== retained) setRetained(target);
  const visible = target ?? retained;
  // Запрос висит всегда (disabled при закрытой шторке): при открытии
  // enabled false→true, а явный staleTime: 0 (поверх дефолта приложения
  // 60с из AppConfig) держит данные всегда stale, поэтому открытие
  // ревалидирует профиль. Это же сужает окно stale-initial
  // для удалённого пользователя (M4 аудита) до одного фетча.
  const user = useUserQuery(target?.id ?? "", { enabled: open, staleTime: 0 });
  const blockStatus = useBlockStatusQuery(target?.id ?? "", { enabled: open });
  const block = useBlockUserMutation();
  const unblock = useUnblockUserMutation();
  const toast = useToast();
  const resetBlockMutation = block.reset;
  const resetUnblockMutation = unblock.reset;

  // Ошибка мутации прошлого профиля не должна переехать в следующую шторку.
  useEffect(() => {
    resetBlockMutation();
    resetUnblockMutation();
  }, [target?.id, resetBlockMutation, resetUnblockMutation]);
  // Пока идёт догрузка, рисуем то, что вызывающий уже знает (initial):
  // карточка не мигает пустотой, если данные уже были на руках.
  // Источник — удержанный target: после закрытия shown остаётся тем же,
  // что был в момент закрытия (см. retainedRef выше).
  const shown = user.data ?? visible?.initial;

  return (
    // Роль, а не имя: имя уже показывает hero ниже, а заголовок-именем
    // давал дубль «ФИО → ФИО». Роль называет контекст встречи.
    <Sheet
      open={open}
      onClose={onClose}
      title={visible?.title ?? shown?.name ?? "Профиль"}
    >
      {visible ? (
        <QueryState
          loading={user.isLoading && !shown}
          error={shown ? undefined : user.error}
          empty={!shown}
          emptyText="Не удалось загрузить профиль"
          onRetry={() => void user.refetch()}
        >
          {shown ? (
            <Stack>
              <ProfileHero user={shown} />
              {/* «О себе» — свободный текст человека, поэтому плашка-цитата
                  (ui/Blockquote): она отделяет слова автора от шапки профиля,
                  а её правило переносов общее для всех таких мест. */}
              {shown.about ? (
                <div className={styles.about}>
                  <Caption className={styles.aboutLabel}>О себе</Caption>
                  <Blockquote>{shown.about}</Blockquote>
                </div>
              ) : null}
              {shown.car ? (
                <div className={styles.car}>
                  <Text weight="2">
                    {`${shown.car.model} · ${shown.car.color}`}
                  </Text>
                </div>
              ) : null}
              <MutationError
                error={block.error ?? unblock.error}
                fallback="Не удалось изменить чёрный список"
              />
              {blockStatus.error ? (
                <Stack gap="xs">
                  <MutationError
                    error={blockStatus.error}
                    fallback="Не удалось проверить чёрный список"
                  />
                  <Button
                    size="m"
                    variant="gray"
                    stretched
                    onClick={() => void blockStatus.refetch()}
                  >
                    Повторить
                  </Button>
                </Stack>
              ) : blockStatus.data?.blockedByMe ? (
                <Button
                  size="m"
                  variant="gray"
                  stretched
                  loading={unblock.isPending}
                  disabled={unblock.isPending}
                  onClick={() =>
                    visible &&
                    unblock.mutate(visible.id, {
                      onSuccess: () => {
                        haptic.success();
                        toast.show({ text: "Пользователь разблокирован" });
                      },
                    })
                  }
                >
                  Убрать из чёрного списка
                </Button>
              ) : blockStatus.data ? (
                <ConfirmPopup
                  label="Добавить в чёрный список"
                  confirmLabel="Заблокировать пользователя"
                  description="Новые поездки между вами исчезнут из поиска, создать новую бронь будет нельзя. Текущие брони и история сохранятся."
                  pending={block.isPending}
                  disabled={block.isPending}
                  mode="plain"
                  destructive
                  nested
                  className={MIN_TARGET}
                  onConfirm={() => {
                    if (!visible) return;
                    block.mutate(visible.id, {
                      onSuccess: () => {
                        haptic.success();
                        toast.show({
                          text: "Пользователь добавлен в чёрный список",
                        });
                        onClose();
                      },
                    });
                  }}
                />
              ) : null}
            </Stack>
          ) : null}
        </QueryState>
      ) : null}
    </Sheet>
  );
}
