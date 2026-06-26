'use client'

import { CheckCircle2, XCircle, Loader2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

type VerifyState = 'idle' | 'fetching' | 'hashing' | 'match' | 'mismatch' | 'error'

interface EvidenceVerifyButtonProps {
  url: string
  /** Stored on-chain SHA-256 hex (may be 0x-prefixed). */
  storedHash: string
}

async function fetchAndHash(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function normalise(hash: string): string {
  return hash.replace(/^0x/i, '').toLowerCase()
}

export function EvidenceVerifyButton({ url, storedHash }: EvidenceVerifyButtonProps) {
  const [state, setState] = useState<VerifyState>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')

  const handleVerify = async () => {
    setState('fetching')
    setErrorMsg('')
    try {
      setState('hashing')
      const computed = await fetchAndHash(url)
      setState(normalise(computed) === normalise(storedHash) ? 'match' : 'mismatch')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Verification failed')
      setState('error')
    }
  }

  if (state === 'idle') {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs gap-1"
        onClick={handleVerify}
        aria-label="Verify file integrity against stored hash"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Verify
      </Button>
    )
  }

  if (state === 'fetching' || state === 'hashing') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {state === 'fetching' ? 'Fetching…' : 'Hashing…'}
      </span>
    )
  }

  if (state === 'match') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium" role="status">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Verified
      </span>
    )
  }

  if (state === 'mismatch') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 font-medium" role="alert">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Hash mismatch
      </span>
    )
  }

  // error — allow retry
  return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive" role="alert">
      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {errorMsg}
      <button
        className="ml-1 underline underline-offset-2"
        onClick={() => setState('idle')}
        aria-label="Retry verification"
      >
        Retry
      </button>
    </span>
  )
}
