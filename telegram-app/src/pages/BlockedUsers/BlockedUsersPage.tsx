import { Avatar, Spinner, VisuallyHidden } from "@telegram-apps/telegram-ui";
import type { BlockedUserItem } from "@edem/contracts";
import { LockOpen } from "lucide-react";
import { QueryState } from "@/components/QueryState";
import { MutationError } from "@/components/MutationError";
import { useInfiniteSentinel } from "@/hooks/useInfiniteSentinel";
import { listBlockingError } from "@/helpers/listBlockingError";
import {
  useInfiniteBlockedUsersQuery,
  useUnblockUserMutation,
} from "@/queries/useBlocksQuery";
import { useToast } from "@/components/Toast/ToastProvider";
import { Cell } from "@/ui/Cell";
import { IconButton } from "@/ui/IconButton";
import { FetchMore } from "@/ui/FetchMore";
import { Page } from "@/ui/Page";
import { Section } from "@/ui/Section";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { ICON_TARGET, STATIC_CELL } from "@/ui/classes";
import { haptic } from "@/utils/haptics";
import { moscowNumericDate } from "@/utils/date";
import styles from "./BlockedUsersPage.module.css";

function BlockedUserRow({
  item,
  pending,
  onUnblock,
}: {
  item: BlockedUserItem;
  pending: boolean;
  onUnblock: (userId: string) => void;
}) {
  return (
    <Cell
      className={`${STATIC_CELL} ${styles.row}`}
      multiline
      before={<Avatar size={40} src={item.user.avatar} alt="" />}
      subtitle={`Добавлен ${moscowNumericDate(item.blockedAt)}`}
      after={
        // На узком iPhone текстовой кнопке не хватает колонки: она
        // вылезала из Cell. Действие — иконка 44×44 в after; полный
        // глагол остаётся в доступном имени и title.
        <IconButton
          variant="outline"
          size="s"
          className={ICON_TARGET}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={`Разблокировать ${item.user.name}`}
          title="Разблокировать"
          onClick={() => onUnblock(item.user.id)}
        >
          {pending ? (
            <Spinner size="s" aria-hidden />
          ) : (
            <LockOpen size={18} aria-hidden />
          )}
        </IconButton>
      }
    >
      <span className={styles.name}>{item.user.name}</span>
    </Cell>
  );
}

export function BlockedUsersPage() {
  const blocked = useInfiniteBlockedUsersQuery();
  const unblock = useUnblockUserMutation();
  const toast = useToast();
  // Offset-лента может сдвинуться, если пользователь разблокировал строку
  // между страницами; дедуп по target id не даёт показать её дважды.
  const items = [
    ...new Map(
      (blocked.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [
        item.user.id,
        item,
      ] as const),
    ).values(),
  ];
  const sentinelRef = useInfiniteSentinel({
    hasNextPage: blocked.hasNextPage,
    isFetchingNextPage: blocked.isFetchingNextPage,
    disabled: blocked.isFetchNextPageError,
    fetchNextPage: () => void blocked.fetchNextPage(),
  });

  return (
    <Page>
      <VisuallyHidden Component="h1">Чёрный список</VisuallyHidden>
      <QueryState
        loading={blocked.isLoading}
        error={listBlockingError(blocked)}
        empty={items.length === 0}
        emptyHeader={EMPTY_STATES.blockedUsersEmpty.header}
        emptyText={EMPTY_STATES.blockedUsersEmpty.description}
        onRetry={() => void blocked.refetch()}
      >
        <Section>
          {items.map((item) => (
            <BlockedUserRow
              key={item.user.id}
              item={item}
              pending={
                unblock.isPending && unblock.variables === item.user.id
              }
              onUnblock={(userId) =>
                unblock.mutate(userId, {
                  onSuccess: () => {
                    haptic.success();
                    toast.show({ text: "Пользователь разблокирован" });
                  },
                })
              }
            />
          ))}
        </Section>
        <MutationError
          error={unblock.error}
          fallback="Не удалось разблокировать пользователя"
        />
        <FetchMore
          hasNextPage={blocked.hasNextPage}
          isFetchingNextPage={blocked.isFetchingNextPage}
          fetchNextPage={() => void blocked.fetchNextPage()}
          error={blocked.isFetchNextPageError ? blocked.error : null}
          sentinelRef={sentinelRef}
        />
      </QueryState>
    </Page>
  );
}
