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
  | 'allowance_checking'  // pre-flight: check token allowance
  | 'approval_needed'     // allowance insufficient, need to approve
  | 'approval_signing'    // wallet.signTransaction for approval
  | 'approval_submitting' // POST /allowances/submit
  | 'approval_polling'    // useTransactionStatus for approval
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
