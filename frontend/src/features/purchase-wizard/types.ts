import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'

export type WizardStep = 0 | 1 | 2

export interface WizardDraft {
  step: WizardStep
  coverageData: Partial<QuoteFormData>
  quote: QuoteResponse | null
  quoteExpiresAt: number | null
}

export type SubmitPhase =
  | 'idle'
  | 'initiating'   // POST /policies/initiate
  | 'signing'      // wallet.signTransaction
  | 'submitting'   // POST /policies/submit
  | 'polling'      // useTransactionStatus
  | 'success'
  | 'error'

export interface SubmitState {
  phase: SubmitPhase
  txHash: string | null
  policyId: string | null
  error: string | null
}

export const WIZARD_DRAFT_KEY = 'purchase-wizard'
export const WIZARD_SCHEMA_VERSION = 1
