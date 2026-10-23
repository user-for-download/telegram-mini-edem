import { Avatar, VisuallyHidden } from "@telegram-apps/telegram-ui";
import type { BlockedUserItem } from "@edem/contracts";
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
import { Button } from "@/ui/Button";
import { FetchMore } from "@/ui/FetchMore";
import { Page } from "@/ui/Page";
import { Section } from "@/ui/Section";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { MIN_TARGET, STATIC_CELL } from "@/ui/classes";
import { haptic } from "@/utils/haptics";
import { moscowNumericDate } from "@/utils/date";

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
      className={STATIC_CELL}
      before={<Avatar size={40} src={item.user.avatar} alt="" />}
      subtitle={`Добавлен ${moscowNumericDate(item.blockedAt)}`}
      after={
        <Button
          size="s"
          variant="gray"
          className={MIN_TARGET}
          loading={pending}
          disabled={pending}
          onClick={() => onUnblock(item.user.id)}
        >
          Разблокировать
        </Button>
      }
    >
      {item.user.name}
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
