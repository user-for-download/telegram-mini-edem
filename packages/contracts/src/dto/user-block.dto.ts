import { z } from "zod";
import { blockedUserItemSchema } from "../schemas/user-block.schema.js";

/** User.id допускает legacy seed-id, поэтому path param — не только UUID. */
export const userBlockTargetParamSchema = z
  .object({
    userId: z.string().trim().min(1).max(100),
  })
  .strict();

export const userBlockListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const paginatedBlockedUsersSchema = z.object({
  items: z.array(blockedUserItemSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(50),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

export type PaginatedBlockedUsers = z.infer<
  typeof paginatedBlockedUsersSchema
>;
