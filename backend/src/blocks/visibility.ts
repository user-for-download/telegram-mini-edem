import type { Prisma } from "../generated/prisma/client.js";

/**
 * Фильтр кандидата, с которым viewer может создавать новые поездки/брони.
 * Пара закрыта записью в любую сторону, но владелец каждой записи остаётся
 * направленным — встречную блокировку пользователь снять не может.
 */
export function visiblePeerWhere(viewerId: string): Prisma.UserWhereInput {
  return {
    blocksCreated: { none: { blockedId: viewerId } },
    blocksReceived: { none: { blockerId: viewerId } },
  };
}

export function pairBlockWhere(
  firstUserId: string,
  secondUserId: string,
): Prisma.UserBlockWhereInput {
  return {
    OR: [
      { blockerId: firstUserId, blockedId: secondUserId },
      { blockerId: secondUserId, blockedId: firstUserId },
    ],
  };
}

/** Проверка обоих направлений; принимает и PrismaClient, и tx-client. */
export async function isPairBlocked(
  client: Pick<Prisma.TransactionClient, "userBlock">,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  const row = await client.userBlock.findFirst({
    where: pairBlockWhere(firstUserId, secondUserId),
    select: { blockerId: true },
  });
  return row !== null;
}
