import { z } from "zod";
import { userSchema } from "./user.schema.js";

/** Пользователь в собственном чёрном списке текущего пользователя. */
export const blockedUserItemSchema = z.object({
  user: userSchema,
  blockedAt: z.string().datetime(),
});

export type BlockedUserItem = z.infer<typeof blockedUserItemSchema>;

/**
 * Статус намеренно раскрывает только собственную направленную запись.
 * `blockedByOther` был бы оракулом того, кто заблокировал пользователя.
 */
export const userBlockStatusSchema = z.object({
  blockedByMe: z.boolean(),
});

export type UserBlockStatus = z.infer<typeof userBlockStatusSchema>;

export const userBlockDeleteResponseSchema = z.object({
  success: z.boolean(),
});

export type UserBlockDeleteResponse = z.infer<
  typeof userBlockDeleteResponseSchema
>;
