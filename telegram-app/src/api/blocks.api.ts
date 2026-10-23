import {
  blockedUserItemSchema,
  paginatedBlockedUsersSchema,
  userBlockDeleteResponseSchema,
  userBlockStatusSchema,
  type BlockedUserItem,
  type PaginatedBlockedUsers,
  type UserBlockDeleteResponse,
  type UserBlockStatus,
} from "@edem/contracts";
import { apiClient } from "./client";

export const blocksApi = {
  list: (
    page = 1,
    limit = 20,
    signal?: AbortSignal,
  ): Promise<PaginatedBlockedUsers> =>
    apiClient.request(
      `/blocks?page=${page}&limit=${limit}`,
      { signal },
      paginatedBlockedUsersSchema,
    ),

  status: (userId: string, signal?: AbortSignal): Promise<UserBlockStatus> =>
    apiClient.request(
      `/blocks/${encodeURIComponent(userId)}`,
      { signal },
      userBlockStatusSchema,
    ),

  block: (userId: string): Promise<BlockedUserItem> =>
    apiClient.request(
      `/blocks/${encodeURIComponent(userId)}`,
      { method: "PUT" },
      blockedUserItemSchema,
    ),

  unblock: (userId: string): Promise<UserBlockDeleteResponse> =>
    apiClient.request(
      `/blocks/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
      userBlockDeleteResponseSchema,
    ),
};
