import { z } from 'zod';
import { getConfig } from '@/config/env';
import { ClaimBoardSchema } from '@/lib/schemas/claims-board';
import type { ClaimFilters } from '@/components/claims/types';
import { FILTER_QUERY_PARAMS } from '@/components/claims/types';

// ── Response schema ──────────────────────────────────────────────────────────

export const ClaimsPageSchema = z.object({
  claims: z.array(ClaimBoardSchema),
  next_cursor: z.string().nullable(),
  total: z.number(),
});

export type ClaimsPage = z.infer<typeof ClaimsPageSchema>;

// ── Sort types ───────────────────────────────────────────────────────────────

export type ClaimSortField = 'deadline' | 'quorum' | 'filed_at';
export type ClaimSortDir = 'asc' | 'desc';

export interface ClaimListParams {
  filters: ClaimFilters;
  sort: ClaimSortField;
  sortDir: ClaimSortDir;
  cursor?: string | null;
  limit?: number;
}

// ── Error class ──────────────────────────────────────────────────────────────

export class ClaimListError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClaimListError';
  }
}

// ── Query param builder ──────────────────────────────────────────────────────

export function buildClaimQueryParams(params: ClaimListParams): URLSearchParams {
  const qs = new URLSearchParams();

  const { filters, sort, sortDir, cursor, limit = 20 } = params;

  if (filters.status !== 'all') {
    qs.set(FILTER_QUERY_PARAMS.status, filters.status);
  }
  if (filters.policyRef) {
    qs.set(FILTER_QUERY_PARAMS.policyRef, filters.policyRef);
  }
  if (filters.submittedAfter) {
    qs.set(FILTER_QUERY_PARAMS.submittedAfter, filters.submittedAfter);
  }
  if (filters.submittedBefore) {
    qs.set(FILTER_QUERY_PARAMS.submittedBefore, filters.submittedBefore);
  }
  if (filters.needsMyVote) {
    qs.set(FILTER_QUERY_PARAMS.needsMyVote, '1');
  }

  qs.set('sort', sort);
  qs.set('sort_dir', sortDir);
  qs.set('limit', String(limit));

  if (cursor) {
    qs.set('after', cursor);
  }

  return qs;
}

// ── Fetch function ───────────────────────────────────────────────────────────

export async function fetchClaims(
  params: ClaimListParams,
  signal?: AbortSignal,
): Promise<ClaimsPage> {
  const { apiUrl } = getConfig();
  const qs = buildClaimQueryParams(params);

  const res = await fetch(`${apiUrl}/api/claims?${qs}`, { signal });

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ code: 'FETCH_FAILED', message: 'Failed to load claims' }));
    throw new ClaimListError(
      err.code ?? 'FETCH_FAILED',
      err.message ?? 'Failed to load claims',
    );
  }

  const json: unknown = await res.json();
  const parsed = ClaimsPageSchema.safeParse(json);

  if (!parsed.success) {
    throw new ClaimListError('PARSE_ERROR', `Invalid response: ${parsed.error.message}`);
  }

  return parsed.data;
}
