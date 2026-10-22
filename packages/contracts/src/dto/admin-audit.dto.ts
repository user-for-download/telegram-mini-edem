import { z } from "zod";
import { adminAuditLogDtoSchema } from "../schemas/admin-audit.schema.js";

export type AdminAuditLogDto = z.infer<typeof adminAuditLogDtoSchema>;

/**
 * Audit list response. Mirrors the admin pagination shape used by every other
 * admin list endpoint: `{ items, total, page, pageSize }`.
 */
export const adminPaginatedAuditLogSchema = z
  .object({
    items: z.array(adminAuditLogDtoSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export type AdminPaginatedAuditLog = z.infer<
  typeof adminPaginatedAuditLogSchema
>;
