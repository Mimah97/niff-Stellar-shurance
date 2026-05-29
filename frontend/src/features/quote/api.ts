import { getConfig } from '@/config/env'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'
import { QuoteResponseSchema } from '@/lib/schemas/quote'
import { QuoteError } from '@/lib/api/quote'

/**
 * GET /quote?policy_type=...&region=...&coverage_tier=...&age=...&risk_score=...
 * Used for the debounced live-quote experience on the /quote page.
 */
export async function fetchQuote(
  params: Required<Pick<QuoteFormData, 'policy_type' | 'region' | 'coverage_tier' | 'age' | 'risk_score'>>,
  signal?: AbortSignal,
): Promise<QuoteResponse> {
  const { apiUrl } = getConfig()
  const qs = new URLSearchParams({
    policy_type: params.policy_type,
    region: params.region,
    coverage_tier: params.coverage_tier,
    age: String(params.age),
    risk_score: String(params.risk_score),
  })

  const res = await fetch(`${apiUrl}/quote?${qs}`, { signal })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ code: 'FETCH_FAILED', message: 'Request failed' }))
    throw new QuoteError(
      (err as { code?: string }).code ?? 'FETCH_FAILED',
      (err as { message?: string }).message ?? 'Failed to fetch quote',
    )
  }

  const json: unknown = await res.json()
  const parsed = QuoteResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new QuoteError('PARSE_ERROR', `Unexpected response: ${parsed.error.message}`)
  }
  return parsed.data
}
