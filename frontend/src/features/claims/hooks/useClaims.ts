'use client';

import { useCallback, useReducer } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchClaims, ClaimListError } from '../api';
import type { ClaimSortField, ClaimSortDir } from '../api';
import type { ClaimFilters } from '@/components/claims/types';
import type { ClaimBoard } from '@/lib/schemas/claims-board';
import { STALE_TIMES } from '@/lib/query/queryClientConfig';

// ── Cursor cache (per filter+sort key) ──────────────────────────────────────

interface CursorState {
  /** cursors[i] = cursor to fetch page i (null = first page). */
  cursors: (string | null)[];
  pageIndex: number;
}

type CursorAction =
  | { type: 'NEXT'; cursor: string | null }
  | { type: 'PREV' }
  | { type: 'RESET' };

function cursorReducer(state: CursorState, action: CursorAction): CursorState {
  switch (action.type) {
    case 'NEXT':
      return {
        pageIndex: state.pageIndex + 1,
        cursors: [...state.cursors, action.cursor],
      };
    case 'PREV':
      return {
        ...state,
        pageIndex: Math.max(0, state.pageIndex - 1),
      };
    case 'RESET':
      return { cursors: [null], pageIndex: 0 };
    default:
      return state;
  }
}

// ── Query key factory ────────────────────────────────────────────────────────

export function claimsQueryKey(
  filters: ClaimFilters,
  sort: ClaimSortField,
  sortDir: ClaimSortDir,
  cursor: string | null,
) {
  return ['claims', { filters, sort, sortDir, cursor }] as const;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseClaimsReturn {
  claims: ClaimBoard[];
  total: number;
  pageIndex: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  refetch: () => void;
}

export function useClaims(
  filters: ClaimFilters,
  sort: ClaimSortField,
  sortDir: ClaimSortDir,
): UseClaimsReturn {
  const queryClient = useQueryClient();

  const [cursorState, dispatch] = useReducer(cursorReducer, {
    cursors: [null],
    pageIndex: 0,
  });

  const currentCursor = cursorState.cursors[cursorState.pageIndex] ?? null;

  const queryKey = claimsQueryKey(filters, sort, sortDir, currentCursor);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchClaims({ filters, sort, sortDir, cursor: currentCursor }, signal),
    staleTime: STALE_TIMES.claims,
    // Retry predicate: skip 4xx (except 429)
    retry: (failureCount, err) => {
      if (err instanceof ClaimListError) {
        // Don't retry parse errors or client errors
        if (err.code === 'PARSE_ERROR') return false;
      }
      return failureCount < 3;
    },
    placeholderData: (prev) => prev,
  });

  // Prefetch next page when current page loads
  const nextCursor = data?.next_cursor ?? null;
  if (data && nextCursor) {
    const nextKey = claimsQueryKey(filters, sort, sortDir, nextCursor);
    queryClient.prefetchQuery({
      queryKey: nextKey,
      queryFn: ({ signal }) =>
        fetchClaims({ filters, sort, sortDir, cursor: nextCursor }, signal),
      staleTime: STALE_TIMES.claims,
    });
  }

  const goToNextPage = useCallback(() => {
    if (!data?.next_cursor) return;
    dispatch({ type: 'NEXT', cursor: data.next_cursor });
  }, [data?.next_cursor]);

  const goToPrevPage = useCallback(() => {
    if (cursorState.pageIndex === 0) return;
    dispatch({ type: 'PREV' });
  }, [cursorState.pageIndex]);

  const handleRefetch = useCallback(() => {
    void refetch();
  }, [refetch]);

  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;

  return {
    claims: data?.claims ?? [],
    total: data?.total ?? 0,
    pageIndex: cursorState.pageIndex,
    hasNextPage: !!data?.next_cursor,
    hasPrevPage: cursorState.pageIndex > 0,
    isLoading,
    isFetching,
    error: errorMessage,
    goToNextPage,
    goToPrevPage,
    refetch: handleRefetch,
  };
}
