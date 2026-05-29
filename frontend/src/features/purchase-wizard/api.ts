import { getConfig } from '@/config/env'
import { apiFetch } from '@/lib/api/fetch'
import type { QuoteFormData } from '@/lib/schemas/quote'

export interface InitiatePolicyResponse {
  transactionXdr: string
  quoteId: string
}

export interface SubmitPolicyResponse {
  policyId: string
  txHash: string
}

export async function initiatePolicy(
  data: QuoteFormData & { walletAddress: string },
  signal?: AbortSignal,
): Promise<InitiatePolicyResponse> {
  const { apiUrl } = getConfig()
  return apiFetch<InitiatePolicyResponse>(`${apiUrl}/api/policies/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  })
}

export async function submitSignedPolicy(
  transactionXdr: string,
  signedXdr: string,
  quoteId: string,
): Promise<SubmitPolicyResponse> {
  const { apiUrl } = getConfig()
  return apiFetch<SubmitPolicyResponse>(`${apiUrl}/api/policies/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionXdr, signedXdr, quoteId }),
  })
}
