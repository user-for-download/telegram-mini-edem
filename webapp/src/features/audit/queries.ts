import { useQuery } from "@tanstack/react-query";

import { fetchAuditLogs, type FetchAuditParams } from "./api";

const auditKey = (params: FetchAuditParams) =>
  ["admin", "audit", params] as const;

export function useAuditQuery(params: FetchAuditParams) {
  return useQuery({
    queryKey: auditKey(params),
    queryFn: () => fetchAuditLogs(params),
  });
}
