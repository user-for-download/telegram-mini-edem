import { useMutation } from "@tanstack/react-query";

/** In-memory only: this metadata must never cross an API/DTO boundary. */
export type WithCommit<T> = T & { onCommitted?: () => boolean };

export function withoutCommit<T extends object>(variables: WithCommit<T>): T {
  const data = { ...variables };
  delete data.onCommitted;
  return data;
}

/** Hook-level success survives observer unmount; per-call callbacks are UI only. */
export function useCommittedMutation<TData, TVariables extends object>(options: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => unknown;
}) {
  return useMutation({
    mutationFn: (variables: WithCommit<TVariables>) =>
      options.mutationFn(withoutCommit(variables)),
    onSuccess: async (data, variables) => {
      try {
        await options.onSuccess?.(data, withoutCommit(variables));
      } finally {
        // The server committed even if a cache-side effect failed.
        variables.onCommitted?.();
      }
    },
  });
}
