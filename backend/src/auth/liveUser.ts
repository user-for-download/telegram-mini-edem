import type { Prisma } from "../generated/prisma/client.js";
import { ACCOUNT_DELETED_MESSAGE, ERROR_CODES, type ErrorCode } from "../errors.js";

export class AccountStateError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: ErrorCode,
    message: string,
    readonly banReason?: string | null,
  ) {
    super(message);
    this.name = "AccountStateError";
  }
}

/** Auth snapshots can predate deletion; writes must check identity inside their transaction. */
export async function requireLiveUser(
  tx: Pick<Prisma.TransactionClient, "user">,
  id: string,
) {
  const user = await tx.user.findUnique({ where: { id }, include: { car: true } });
  if (!user) throw new AccountStateError(401, ERROR_CODES.UNAUTHORIZED, "Unauthorized");
  if (user.deletedAt) {
    throw new AccountStateError(403, ERROR_CODES.ACCOUNT_DELETED, ACCOUNT_DELETED_MESSAGE);
  }
  if (user.bannedAt) {
    throw new AccountStateError(403, ERROR_CODES.FORBIDDEN, "Account is banned", user.banReason);
  }
  return user;
}
