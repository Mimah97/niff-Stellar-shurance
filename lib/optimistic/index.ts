import { useMutation, useQueryClient, type QueryKey, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface OptimisticMutationConfig<TData, TVariables, TContext = unknown> {
  /** Query key(s) whose cached data should be optimistically updated. */
  queryKey: QueryKey;
  /** Apply the optimistic change to the current cached data. */
  apply: (current: TData | undefined, variables: TVariables) => TData;
  /** Optional custom rollback. Defaults to restoring the previous snapshot. */
  rollback?: (current: TData | undefined, variables: TVariables, context: TContext) => TData;
  /** Optional message shown in the rollback toast. */
  errorMessage?: string;
}

/**
 * Wraps `useMutation` with optimistic cache updates:
 * - applies the optimistic change immediately (onMutate)
 * - rolls back and shows a toast on error (onError)
 * - reconciles with confirmed server data on success (onSuccess)
 *
 * On-chain actions should only surface an optimistic "pending" state here;
 * final numbers must always come from confirmed data via reconciliation.
 */
export function optimisticMutation<TData, TVariables, TContext = unknown>(
  config: OptimisticMutationConfig<TData, TVariables, TContext>,
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
): UseMutationResult<TData, Error, TVariables, TContext> {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables, TContext>({
    ...options,
    onMutate: async (variables, mutationContext) => {
      await queryClient.cancelQueries({ queryKey: config.queryKey });
      const previous = queryClient.getQueryData<TData>(config.queryKey);

      queryClient.setQueryData<TData>(config.queryKey, (current) =>
        config.apply(current, variables),
      );

      const context = (await options.onMutate?.(variables, mutationContext)) as TContext;
      return { previous, ...(context as object) } as TContext;
    },
    onError: (error, variables, context, mutationContext) => {
      const snapshot = context as { previous?: TData } | undefined;
      if (config.rollback) {
        queryClient.setQueryData<TData>(config.queryKey, (current) =>
          config.rollback!(current, variables, context as TContext),
        );
      } else if (snapshot && 'previous' in snapshot) {
        queryClient.setQueryData<TData>(config.queryKey, snapshot.previous);
      }

      toast.error(config.errorMessage ?? error.message);
      options.onError?.(error, variables, context, mutationContext);
    },
    onSuccess: (data, variables, context, mutationContext) => {
      // Reconcile with confirmed data from the server.
      queryClient.invalidateQueries({ queryKey: config.queryKey });
      options.onSuccess?.(data, variables, context, mutationContext);
    },
    onSettled: (data, error, variables, context, mutationContext) => {
      options.onSettled?.(data, error, variables, context, mutationContext);
    },
  });
}

export default optimisticMutation;
