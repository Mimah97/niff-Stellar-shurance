'use client'

import { useQuery } from '@tanstack/react-query'
import { getConfig } from '@/config/env'

export type WhitelistStatus = 'verified' | 'pending' | 'not_eligible'

export interface WhitelistCheckResult {
  status: WhitelistStatus
  address: string
}

async function checkWhitelist(address: string): Promise<WhitelistCheckResult> {
  const { apiUrl } = getConfig()
  const res = await fetch(
    `${apiUrl}/api/whitelist/check?address=${encodeURIComponent(address)}`,
    { credentials: 'include' },
  )
  if (!res.ok) {
    // Treat non-2xx as not eligible rather than throwing — the feature may be
    // partially rolled out and we don't want to break the header on errors.
    return { status: 'not_eligible', address }
  }
  const json = await res.json() as { status?: string }
  const raw = json?.status
  const status: WhitelistStatus =
    raw === 'verified' || raw === 'pending' ? raw : 'not_eligible'
  return { status, address }
}

/**
 * Checks whitelist status for a connected wallet address.
 *
 * Only runs when `address` is provided and `NEXT_PUBLIC_WHITELIST_ENABLED=true`.
 * Results are cached for 5 minutes to avoid hammering the API on re-renders.
 */
export function useWhitelistStatus(address: string | undefined) {
  const enabled =
    !!address && process.env.NEXT_PUBLIC_WHITELIST_ENABLED === 'true'

  return useQuery<WhitelistCheckResult>({
    queryKey: ['whitelist-status', address],
    queryFn: () => checkWhitelist(address!),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: 1,
  })
}
