import { useMutation, useQueryClient, type QueryKey, type UseMutationOptions } from '@tanstack/react-query';

/**
 * Minimal toast surface. Consumers pass a function that renders a message;
 * keeping it injectable avoids coupling this util to a specific toast library.
 */
export type ToastFn = (message: string, options?: { variant?: 'error' | 'info' }) => void;

export interface OptimisticMutationConfig<TData, TVariables, TContext> {
  /** Query key (or keys) whose cached data should be optimistically updated. */
  queryKey: QueryKey | QueryKey[];
  /**
   * Apply the optimistic change to the current cached data.
   * Return the next cached value. May be async.
   */
  apply: (current: TData | undefined, variables: TVariables) => TData | Promise<TData>;
  /**
   * Optional explicit rollback. When omitted, the previous snapshot captured
   * before `apply` is restored on error.
   */
  rollback?: (current: TData | undefined, variables: TVariables, context: TContext | undefined) => TData | Promise<TData>;
  /**
   * Reconcile the cache with confirmed server data on success.
   * Return the authoritative value (e.g. from the mutation response).
   */
  reconcile?: (data: unknown, variables: TVariables, current: TData | undefined) => TData | Promise<TData>;
  /** Toast used to surface the rollback error message. */
  toast?: ToastFn;
  /** Extra options forwarded to useMutation (onSuccess/onError are composed). */
  mutationOptions?: Omit<
    UseMutationOptions<unknown, Error, TVariables, TContext>,
    'onMutate' | 'onError' | 'onSuccess'
  >;
}

interface Snapshot<TData> {
  previous: Array<[QueryKey, TData | undefined]>;
}

function toKeys(queryKey: QueryKey | QueryKey[]): QueryKey[] {
  if (Array.isArray(queryKey) && queryKey.length > 0 && Array.isArray(queryKey[0])) {
    return queryKey as QueryKey[];
  }
  return [queryKey as QueryKey];
}

/**
 * Wraps `useMutation` with optimistic cache updates:
 *  - applies the optimistic change immediately (onMutate)
 *  - rolls back to the snapshot on error and shows a toast with the error message
 *  - reconciles the cache with confirmed data on success
 *
 * On-chain actions should only ever show an optimistic "pending" state here;
 * final numbers must come from confirmed data via `reconcile`.
 */
export function optimisticMutation<TData, TVariables = void, TContext = unknown>(
  config: OptimisticMutationConfig<TData, TVariables, TContext>,
) {
  const queryClient = useQueryClient();
  const keys = toKeys(config.queryKey);

  return useMutation<unknown, Error, TVariables, TContext>({
    ...config.mutationOptions,
    onMutate: async (variables) => {
      await Promise.all(keys.map((key) => queryClient.cancelQueries({ queryKey: key })));

      const previous: Snapshot<TData>['previous'] = keys.map((key) => [
        key,
        queryClient.getQueryData<TData>(key),
      ]);

      await Promise.all(
        keys.map(async (key) => {
          const current = queryClient.getQueryData<TData>(key);
          const next = await config.apply(current, variables);
          queryClient.setQueryData<TData>(key, next);
        }),
      );

      return { previous } as unknown as TContext;
    },
    onError: async (error, variables, context) => {
      const snapshot = (context as unknown as Snapshot<TData> | undefined)?.previous;

      if (config.rollback) {
        await Promise.all(
          keys.map(async (key) => {
            const current = queryClient.getQueryData<TData>(key);
            const next = await config.rollback!(current, variables, context);
            queryClient.setQueryData<TData>(key, next);
          }),
        );
      } else if (snapshot) {
        for (const [key, value] of snapshot) {
          queryClient.setQueryData<TData>(key, value);
        }
      }

      config.toast?.(error.message, { variant: 'error' });
    },
    onSuccess: async (data, variables) => {
      if (config.reconcile) {
        await Promise.all(
          keys.map(async (key) => {
            const current = queryClient.getQueryData<TData>(key);
            const next = await config.reconcile!(data, variables, current);
            queryClient.setQueryData<TData>(key, next);
          }),
        );
      } else {
        await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      }
    },
  });
}

export default optimisticMutation;
