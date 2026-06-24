import { getConfig } from '@/config/env'
import { apiFetch } from '@/lib/api/fetch'
import { ChainReadError } from '@/lib/api/chain'
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

// ── Token allowance pre-flight ────────────────────────────────────────────────

export interface AllowanceCheckResponse {
  /** The current allowance the holder has granted to the contract (in stroops). */
  currentAllowance: string
  /** The amount required for the premium payment (in stroops). */
  requiredAmount: string
  /** Whether the current allowance is sufficient. */
  sufficient: boolean
  /** The contract address to approve. */
  contractAddress: string
  /** The token contract address (SEP-41). */
  tokenAddress: string
}

export interface BuildApprovalResponse {
  transactionXdr: string
  quoteId: string
}

/**
 * Check the token allowance for the policy contract address.
 * Uses the backend /api/chain/allowance simulation endpoint.
 */
export async function checkAllowance(
  walletAddress: string,
  contractAddress: string,
  requiredAmount: string,
  signal?: AbortSignal,
): Promise<AllowanceCheckResponse> {
  const { apiUrl, contractId } = getConfig()
  const res = await fetch(`${apiUrl}/api/chain/allowance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress,
      contractAddress: contractAddress || contractId,
      requiredAmount,
    }),
    signal,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ChainReadError(
      (body as { code?: string }).code ?? 'ALLOWANCE_CHECK_FAILED',
      (body as { message?: string }).message ?? 'Failed to check token allowance',
    )
  }
  return res.json()
}

/**
 * Create an approval (allowance) transaction for the policy contract.
 * Returns an unsigned XDR that the user must sign with their wallet.
 */
export async function buildApprovalTransaction(
  walletAddress: string,
  contractAddress: string,
  amount: string,
): Promise<BuildApprovalResponse> {
  const { apiUrl, contractId } = getConfig()
  return apiFetch<BuildApprovalResponse>(`${apiUrl}/api/allowances/build-approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress,
      contractAddress: contractAddress || contractId,
      amount,
    }),
  })
}

/**
 * Submit a signed approval transaction.
 */
export async function submitApprovalTransaction(
  transactionXdr: string,
  signedXdr: string,
  quoteId: string,
): Promise<{ txHash: string }> {
  const { apiUrl } = getConfig()
  return apiFetch<{ txHash: string }>(`${apiUrl}/api/allowances/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionXdr, signedXdr, quoteId }),
  })
}
