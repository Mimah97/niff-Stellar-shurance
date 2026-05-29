'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchQuote } from './api'
import { useDebounce } from '@/hooks/use-debounce'
import { QuoteError, getQuoteErrorMessage } from '@/lib/api/quote'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'

export type QuoteStatus = 'idle' | 'loading' | 'success' | 'error'

export interface QuoteState {
  status: QuoteStatus
  quote: QuoteResponse | null
  error: string | null
}

type ValidInputs = Required<Pick<QuoteFormData, 'policy_type' | 'region' | 'coverage_tier' | 'age' | 'risk_score'>>

export function useQuote(inputs: Partial<ValidInputs> | null, debounceMs = 400): QuoteState {
  const [state, setState] = useState<QuoteState>({ status: 'idle', quote: null, error: null })
  const seqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // Only debounce when we have complete valid inputs
  const complete = isComplete(inputs) ? inputs : null
  const debounced = useDebounce(complete, debounceMs)

  useEffect(() => {
    if (!debounced) {
      abortRef.current?.abort()
      setState({ status: 'idle', quote: null, error: null })
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const seq = ++seqRef.current

    setState((s) => ({ ...s, status: 'loading', error: null }))

    fetchQuote(debounced, ctrl.signal).then(
      (quote) => {
        if (seq !== seqRef.current) return // stale
        setState({ status: 'success', quote, error: null })
      },
      (err: unknown) => {
        if ((err as Error).name === 'AbortError') return
        if (seq !== seqRef.current) return
        const msg = err instanceof QuoteError ? getQuoteErrorMessage(err) : 'Failed to fetch quote'
        setState({ status: 'error', quote: null, error: msg })
      },
    )

    return () => ctrl.abort()
  }, [debounced])

  return state
}

function isComplete(inputs: Partial<ValidInputs> | null): inputs is ValidInputs {
  if (!inputs) return false
  return !!(
    inputs.policy_type &&
    inputs.region &&
    inputs.coverage_tier &&
    typeof inputs.age === 'number' &&
    inputs.age >= 1 &&
    inputs.age <= 120 &&
    typeof inputs.risk_score === 'number' &&
    inputs.risk_score >= 1 &&
    inputs.risk_score <= 10
  )
}
