// backend/src/admin/audit.ts
// Аудит админ-действий: единая точка записи в append-only журнал
// AdminAuditLog. Вызывается из админ-роутов (и, при необходимости, воркеров)
// рядом с самой мутацией.
//
// Клиент передаётся снаружи, чтобы запись шла в ТОЙ ЖЕ транзакции, что и
// изменение: `recordAdminAudit(tx, ...)` внутри `db.$transaction` — либо
// `recordAdminAudit(db, ...)` для простых одиночных мутаций.
//
// В `metadata` попадают только id/статусы/счётчики (то, что админ и так
// видит за adminGuard) — никаких имён, телефонов и свободного текста.
import type {
  AdminAuditAction,
  AdminAuditActorType,
  AdminAuditTargetType,
} from "@edem/contracts";
// `Prisma` нужен и как пространство типов, и как значение (Prisma.DbNull).
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/** Любой клиент, умеющий писать в БД: корневой или транзакционный. */
export type AdminAuditClient = Prisma.TransactionClient | PrismaClient;

export interface RecordAdminAuditInput {
  /** Действие из закрытого списка ADMIN_AUDIT_ACTIONS. */
  action: AdminAuditAction;
  /** Тип цели (user/trip/booking/...). */
  targetType: AdminAuditTargetType;
  /** id цели; null/undefined для действий без объекта. */
  targetId?: string | null;
  /** JSON-снапшот мутации (id/статусы/счётчики). Без PII. */
  metadata?: Prisma.InputJsonValue | null;
  /** Кто выполнил: "admin" (guard) или "system" (воркер). По умолчанию "admin". */
  actorType?: AdminAuditActorType;
}

/**
 * Записать одну строку аудита. Возвращает созданную запись, чтобы вызывающий
 * код при необходимости мог её залогировать/сверить.
 */
export async function recordAdminAudit(
  client: AdminAuditClient,
  input: RecordAdminAuditInput,
) {
  return client.adminAuditLog.create({
    data: {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      // DbNull = SQL NULL (поля нет), а не JSON-литерал null.
      metadata: input.metadata ?? Prisma.DbNull,
      actorType: input.actorType ?? "admin",
    },
  });
}
