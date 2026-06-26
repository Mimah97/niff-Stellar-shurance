"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import {
  type ClaimFilters,
  type ClaimSortOrder,
  DEFAULT_FILTERS,
  FILTER_QUERY_PARAMS,
  VALID_SORT_ORDERS,
  CLAIMS_SORT_STORAGE_KEY,
} from "@/components/claims/types";

/**
 * Reads initial ClaimFilters from URL search params on mount and writes
 * filter changes back to the URL via router.replace (no new history entry).
 * The sort preference is additionally persisted in localStorage so it
 * survives navigation and new sessions (restored when the URL has no sort param).
 *
 * Requirements: 5.3, 5.4
 */
export function useQueryParamFilters(): [
  ClaimFilters,
  (f: ClaimFilters) => void,
] {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Parse initial filter state from URL; fall back to localStorage for sort.
  const [filters] = useState<ClaimFilters>(() =>
    parseFiltersFromParams(searchParams),
  );

  const setFilters = useCallback(
    (newFilters: ClaimFilters) => {
      const params = new URLSearchParams(searchParams.toString());

      // status
      if (newFilters.status !== DEFAULT_FILTERS.status) {
        params.set(FILTER_QUERY_PARAMS.status, newFilters.status);
      } else {
        params.delete(FILTER_QUERY_PARAMS.status);
      }

      // policyRef
      if (newFilters.policyRef) {
        params.set(FILTER_QUERY_PARAMS.policyRef, newFilters.policyRef);
      } else {
        params.delete(FILTER_QUERY_PARAMS.policyRef);
      }

      // submittedAfter
      if (newFilters.submittedAfter) {
        params.set(
          FILTER_QUERY_PARAMS.submittedAfter,
          newFilters.submittedAfter,
        );
      } else {
        params.delete(FILTER_QUERY_PARAMS.submittedAfter);
      }

      // submittedBefore
      if (newFilters.submittedBefore) {
        params.set(
          FILTER_QUERY_PARAMS.submittedBefore,
          newFilters.submittedBefore,
        );
      } else {
        params.delete(FILTER_QUERY_PARAMS.submittedBefore);
      }

      // needsMyVote — "1" when true, absent when false
      if (newFilters.needsMyVote) {
        params.set(FILTER_QUERY_PARAMS.needsMyVote, "1");
      } else {
        params.delete(FILTER_QUERY_PARAMS.needsMyVote);
      }

      // sort — persist to localStorage and URL
      if (newFilters.sort !== DEFAULT_FILTERS.sort) {
        params.set(FILTER_QUERY_PARAMS.sort, newFilters.sort);
      } else {
        params.delete(FILTER_QUERY_PARAMS.sort);
      }
      try {
        localStorage.setItem(CLAIMS_SORT_STORAGE_KEY, newFilters.sort);
      } catch {
        // localStorage may be unavailable (private browsing, storage full)
      }

      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  return [filters, setFilters];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set<string>(["open", "closed", "pending", "all"]);

function readStoredSort(): ClaimSortOrder {
  try {
    const stored = localStorage.getItem(CLAIMS_SORT_STORAGE_KEY);
    if (stored && VALID_SORT_ORDERS.has(stored)) {
      return stored as ClaimSortOrder;
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_FILTERS.sort;
}

function parseFiltersFromParams(
  searchParams: ReturnType<typeof useSearchParams>,
): ClaimFilters {
  const status = searchParams.get(FILTER_QUERY_PARAMS.status);
  const policyRef = searchParams.get(FILTER_QUERY_PARAMS.policyRef);
  const submittedAfter = searchParams.get(FILTER_QUERY_PARAMS.submittedAfter);
  const submittedBefore = searchParams.get(FILTER_QUERY_PARAMS.submittedBefore);
  const needsMyVoteRaw = searchParams.get(FILTER_QUERY_PARAMS.needsMyVote);
  const sortRaw = searchParams.get(FILTER_QUERY_PARAMS.sort);

  // URL sort param takes precedence; fall back to localStorage then default.
  const sort: ClaimSortOrder =
    sortRaw && VALID_SORT_ORDERS.has(sortRaw)
      ? (sortRaw as ClaimSortOrder)
      : readStoredSort();

  return {
    status:
      status && VALID_STATUSES.has(status)
        ? (status as ClaimFilters["status"])
        : DEFAULT_FILTERS.status,
    policyRef: policyRef ?? DEFAULT_FILTERS.policyRef,
    submittedAfter: submittedAfter ?? DEFAULT_FILTERS.submittedAfter,
    submittedBefore: submittedBefore ?? DEFAULT_FILTERS.submittedBefore,
    needsMyVote: needsMyVoteRaw === "1",
    sort,
  };
}
