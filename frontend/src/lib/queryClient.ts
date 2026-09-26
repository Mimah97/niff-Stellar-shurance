import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Query key helpers shared by the app and the live event stream.
 * Keeping them in one place lets the SSE handlers patch the exact same
 * cache entries that components read from.
 */
export const queryKeys = {
  claims: ['claims'] as const,
  claim: (id: string) => ['claims', id] as const,
  claimTally: (id: string) => ['claims', id, 'tally'] as const,
  claimStatus: (id: string) => ['claims', id, 'status'] as const,
  transactions: ['transactions'] as const,
  transaction: (id: string) => ['transactions', id] as const,
};
