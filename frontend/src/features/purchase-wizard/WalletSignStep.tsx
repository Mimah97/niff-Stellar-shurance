'use client'

import { AlertCircle, CheckCircle, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StellarExplorerLink } from '@/components/ui/StellarExplorerLink'
import { useWallet } from '@/features/wallet'
import { WalletConnectButton } from '@/features/wallet'
import { useTransactionStatus } from '@/hooks/useTransactionStatus'
import { initiatePolicy, submitSignedPolicy } from './api'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'
import type { SubmitPhase, SubmitState } from './types'
import { AppError } from '@/lib/errors'

interface Props {
  coverageData: QuoteFormData
  quote: QuoteResponse
  quoteExpiresAt: number
  onBack: () => void
  onSuccess: () => void
}

const PHASE_LABELS: Record<SubmitPhase, string> = {
  idle: '',
  initiating: 'Preparing transaction…',
  signing: 'Waiting for wallet signature…',
  submitting: 'Submitting to network…',
  polling: 'Confirming on-chain…',
  success: 'Policy created!',
  error: '',
}

function PhaseStatus({ phase }: { phase: SubmitPhase }) {
  if (phase === 'idle' || phase === 'error') return null
  if (phase === 'success') {
    return (
      <div className="flex items-center gap-2 text-green-600" role="status">
        <CheckCircle className="h-5 w-5" aria-hidden="true" />
        <span className="font-medium">{PHASE_LABELS.success}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{PHASE_LABELS[phase]}</span>
    </div>
  )
}

export function WalletSignStep({ coverageData, quote, quoteExpiresAt, onBack, onSuccess }: Props) {
  const router = useRouter()
  const { address, connectionStatus, signTransaction } = useWallet()
  const [state, setState] = useState<SubmitState>({
    phase: 'idle',
    txHash: null,
    policyId: null,
    error: null,
  })
  const submittedRef = useRef(false)

  const txStatus = useTransactionStatus(
    state.phase === 'polling' ? state.txHash : null,
  )

  // Handle polling terminal states
  useEffect(() => {
    if (state.phase !== 'polling') return
    if (txStatus.status === 'SUCCESS' && state.policyId) {
      setState((s) => ({ ...s, phase: 'success' }))
      onSuccess()
      router.push(`/policies/${state.policyId}`)
    } else if (txStatus.status === 'FAILED' || txStatus.status === 'NOT_FOUND_TIMEOUT') {
      setState((s) => ({
        ...s,
        phase: 'error',
        error: txStatus.status === 'FAILED'
          ? 'Transaction failed on-chain. Please try again.'
          : 'Transaction not confirmed in time. Check your wallet or try again.',
      }))
    }
  }, [txStatus.status, state.phase, state.policyId, onSuccess, router])

  const isQuoteExpired = quoteExpiresAt < Date.now()

  const handleSubmit = useCallback(async () => {
    if (submittedRef.current) return
    if (!address) return
    if (isQuoteExpired) {
      setState((s) => ({ ...s, phase: 'error', error: 'Quote has expired. Please go back and regenerate.' }))
      return
    }

    submittedRef.current = true
    setState({ phase: 'initiating', txHash: null, policyId: null, error: null })

    try {
      // Step 1: Initiate — get unsigned XDR
      const { transactionXdr, quoteId } = await initiatePolicy({
        ...coverageData,
        walletAddress: address,
      })

      // Step 2: Sign
      setState((s) => ({ ...s, phase: 'signing' }))
      let signedXdr: string
      try {
        signedXdr = await signTransaction(transactionXdr)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const isRejection = msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')
        setState({
          phase: 'error',
          txHash: null,
          policyId: null,
          error: isRejection
            ? 'You rejected the transaction in your wallet. Click "Sign & Submit" to try again.'
            : `Signing failed: ${msg}`,
        })
        submittedRef.current = false
        return
      }

      // Step 3: Submit
      setState((s) => ({ ...s, phase: 'submitting' }))
      const { policyId, txHash } = await submitSignedPolicy(transactionXdr, signedXdr, quoteId)

      // Step 4: Poll
      setState({ phase: 'polling', txHash, policyId, error: null })
    } catch (err) {
      const msg = err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'An unexpected error occurred'
      setState({ phase: 'error', txHash: null, policyId: null, error: msg })
      submittedRef.current = false
    }
  }, [address, coverageData, isQuoteExpired, signTransaction])

  const handleRetry = () => {
    submittedRef.current = false
    setState({ phase: 'idle', txHash: null, policyId: null, error: null })
  }

  const isSubmitting = ['initiating', 'signing', 'submitting', 'polling'].includes(state.phase)

  if (connectionStatus !== 'connected') {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4 text-center">
            <Wallet className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Connect your wallet to sign and submit</p>
            <p className="text-sm text-muted-foreground">
              You need a connected Stellar wallet to purchase this policy.
            </p>
            <WalletConnectButton />
          </CardContent>
        </Card>
        <Button variant="outline" onClick={onBack}>Back</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Premium</dt>
              <dd className="font-medium">{quote.premiumXlm} XLM</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Policy Type</dt>
              <dd className="font-medium">{coverageData.policy_type}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Wallet</dt>
              <dd className="font-medium font-mono text-xs truncate">{address}</dd>
            </div>
          </dl>

          {isQuoteExpired && (
            <div className="flex items-center gap-2 text-orange-600 text-sm" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              Quote has expired. Please go back and regenerate.
            </div>
          )}

          <PhaseStatus phase={state.phase} />

          {state.phase === 'polling' && state.txHash && (
            <StellarExplorerLink type="tx" value={state.txHash} label="View on explorer" />
          )}
        </CardContent>
      </Card>

      {state.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 space-y-3" role="alert">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium text-sm">Submission failed</p>
              <p className="text-sm">{state.error}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Try Again
            </Button>
            {state.error.includes('expired') && (
              <Button size="sm" variant="outline" onClick={onBack}>
                Regenerate Quote
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || isQuoteExpired || state.phase === 'success'}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Processing…</>
          ) : (
            'Sign & Submit'
          )}
        </Button>
      </div>
    </div>
  )
}
