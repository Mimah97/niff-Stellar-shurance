'use client'

import { CheckCircle, XCircle, ExternalLink, AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useWallet } from '@/features/wallet'
import { useLatestLedger } from '@/hooks/use-latest-ledger'
import {
  fetchClaim,
  fetchEligibility,
  simulateVote,
  submitVote,
  explorerUrl,
  getVoteErrorMessage,
  VoteAPIError,
  checkAppealStatus,
  simulateAppeal,
  submitAppeal,
  getAppealErrorMessage,
} from '@/lib/api/vote'
import {
  Claim,
  Eligibility,
  VoteOption,
  isTerminal,
  isVoteOpen,
} from '@/lib/schemas/vote'
import { trackVoteCast } from '@/lib/analytics'

import { AppealButton } from './AppealButton'
import { AppealConfirmModal } from './AppealConfirmModal'
import { EvidenceVerifyButton } from './EvidenceVerifyButton'
import { VoteConfirmModal } from './vote-confirm-modal'
import { VoteEducationPanel } from './vote-education-panel'
import { VoteTally } from './vote-tally'

interface ClaimVotePanelProps {
  claimId: string
}

type SubmitState = 'idle' | 'simulating' | 'confirming' | 'signing' | 'submitting' | 'done'
type AppealState = 'idle' | 'confirming' | 'signing' | 'submitting' | 'done'

const POLL_INTERVAL_MS = 8_000

export function ClaimVotePanel({ claimId }: ClaimVotePanelProps) {
  const { address: walletAddress, signTransaction } = useWallet()
  const latestLedger = useLatestLedger()
  const currentLedger = latestLedger ?? 0
  const { toast } = useToast()

  const [claim, setClaim] = useState<Claim | null>(null)
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [loadingClaim, setLoadingClaim] = useState(true)
  const [loadingEligibility, setLoadingEligibility] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)

  const [pendingVote, setPendingVote] = useState<VoteOption | null>(null)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [simError, setSimError] = useState<string | null>(null)

  // Appeal state
  const [appealState, setAppealState] = useState<AppealState>('idle')
  const [appealSubmitted, setAppealSubmitted] = useState(false)
  const [appealTxHash, setAppealTxHash] = useState<string | null>(null)
  const [appealError, setAppealError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load claim ──────────────────────────────────────────────────────────────
  const loadClaim = useCallback(async () => {
    try {
      const c = await fetchClaim(claimId)
      setClaim(c)
      setClaimError(null)
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Failed to load claim')
    }
  }, [claimId])

  useEffect(() => {
    setLoadingClaim(true)
    loadClaim().finally(() => setLoadingClaim(false))
  }, [loadClaim])

  // ── Poll tally while vote is open ───────────────────────────────────────────
  useEffect(() => {
    if (!claim) return
    if (isTerminal(claim.status) || !isVoteOpen(claim.voting_deadline_ledger, currentLedger)) return

    pollRef.current = setInterval(loadClaim, POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [claim, currentLedger, loadClaim])

  // ── Load eligibility when wallet connects ───────────────────────────────────
  useEffect(() => {
    if (!walletAddress || !claimId) return
    setLoadingEligibility(true)
    fetchEligibility(claimId, walletAddress)
      .then(setEligibility)
      .catch(() => setEligibility(null))
      .finally(() => setLoadingEligibility(false))
  }, [claimId, walletAddress])

  // ── Check appeal status for rejected claims ─────────────────────────────────
  useEffect(() => {
    if (!claim || claim.status !== 'Rejected') return
    checkAppealStatus(claimId)
      .then(setAppealSubmitted)
      .catch(() => setAppealSubmitted(false))
  }, [claim, claimId])

  // ── Vote flow ───────────────────────────────────────────────────────────────
  const handleVoteClick = useCallback(
    async (vote: VoteOption) => {
      if (!walletAddress) return
      setSimError(null)
      setSubmitState('simulating')

      const simErr = await simulateVote(claimId, walletAddress, vote)
      if (simErr) {
        setSimError(simErr)
        setSubmitState('idle')
        return
      }

      setPendingVote(vote)
      setSubmitState('confirming')
    },
    [claimId, walletAddress],
  )

  const handleConfirm = useCallback(async () => {
    if (!pendingVote || !walletAddress) return
    setSubmitState('signing')

    try {
      // In production, requestSignature opens the wallet popup with the XDR.
      // Here we pass a placeholder XDR; the backend builds the real transaction.
      const signedXdr = await signTransaction(`vote:${claimId}:${pendingVote}`)

      setSubmitState('submitting')
      const result = await submitVote(claimId, walletAddress, pendingVote, signedXdr)

      setTxHash(result.transactionHash)
      setClaim((prev) =>
        prev
          ? {
              ...prev,
              status: result.status,
              approve_votes: result.approve_votes,
              reject_votes: result.reject_votes,
            }
          : prev,
      )
      setEligibility((prev) => (prev ? { ...prev, priorVote: pendingVote } : prev))
      setSubmitState('done')
      trackVoteCast(pendingVote === 'Approve' ? 'approve' : 'reject')

      toast({
        title: 'Vote submitted',
        description: `Your ${pendingVote.toLowerCase()} vote was recorded on-chain.`,
      })
    } catch (e) {
      const msg =
        e instanceof VoteAPIError
          ? getVoteErrorMessage(e)
          : e instanceof Error
            ? e.message
            : 'Vote submission failed'
      toast({ title: 'Vote failed', description: msg, variant: 'destructive' })
      setSubmitState('idle')
    } finally {
      setPendingVote(null)
    }
  }, [claimId, pendingVote, signTransaction, toast, walletAddress])

  const handleCancel = useCallback(() => {
    setPendingVote(null)
    setSubmitState('idle')
  }, [])

  // ── Appeal flow ─────────────────────────────────────────────────────────────
  const handleAppealClick = useCallback(() => {
    setAppealError(null)
    setAppealState('confirming')
  }, [])

  const handleAppealConfirm = useCallback(async () => {
    if (!walletAddress) return
    setAppealState('signing')

    try {
      // Simulate appeal first
      const simErr = await simulateAppeal(claimId, walletAddress)
      if (simErr) {
        setAppealError(simErr)
        setAppealState('idle')
        toast({
          title: 'Appeal simulation failed',
          description: simErr,
          variant: 'destructive',
        })
        return
      }

      // Request wallet signature
      const signedXdr = await signTransaction(`appeal:${claimId}`)

      setAppealState('submitting')
      const result = await submitAppeal(claimId, walletAddress, signedXdr)

      setAppealTxHash(result.transactionHash)
      setAppealSubmitted(true)
      setAppealState('done')

      // Reload claim to get updated status
      await loadClaim()

      toast({
        title: 'Appeal submitted',
        description: 'Your appeal has been submitted successfully. A new voting window is now open.',
      })
    } catch (e) {
      const msg =
        e instanceof VoteAPIError
          ? getAppealErrorMessage(e)
          : e instanceof Error
            ? e.message
            : 'Appeal submission failed'
      setAppealError(msg)
      toast({ title: 'Appeal failed', description: msg, variant: 'destructive' })
      setAppealState('idle')
    }
  }, [claimId, walletAddress, signTransaction, toast, loadClaim])

  const handleAppealCancel = useCallback(() => {
    setAppealState('idle')
  }, [])

  // ── Derived state ───────────────────────────────────────────────────────────
  const voteOpen = claim ? isVoteOpen(claim.voting_deadline_ledger, currentLedger) : false
  const terminal = claim ? isTerminal(claim.status) : false
  const alreadyVoted = eligibility?.priorVote != null
  const eligible = eligibility?.eligible === true
  const ineligibleReason = eligibility?.reason

  const hasVoteActions =
    !!walletAddress &&
    eligible &&
    !alreadyVoted &&
    voteOpen &&
    !terminal

  const disabledTooltip = !walletAddress
    ? 'Connect your wallet to vote'
    : !eligible
      ? (ineligibleReason ?? 'Your wallet is not eligible to vote on this claim')
      : alreadyVoted
        ? `You already voted ${eligibility.priorVote?.toLowerCase()} on this claim`
        : !voteOpen
          ? 'The voting window for this claim has closed'
          : terminal
            ? 'This claim has already been resolved'
            : submitState === 'done'
              ? 'Your vote has been submitted successfully.'
              : submitState !== 'idle'
                ? 'Your vote is being processed.'
                : undefined

  const showVoteActions = hasVoteActions && submitState === 'idle'

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loadingClaim) {
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading claim">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (claimError || !claim) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      >
        <AlertTriangle className="mb-1 inline h-4 w-4" aria-hidden="true" />{' '}
        {claimError ?? 'Claim not found.'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Governance education — always visible, not confused with premium flows */}
      <VoteEducationPanel />

      {/* Live tally */}
      <VoteTally claim={claim} currentLedger={currentLedger} />

      {/* Evidence */}
      {claim.evidence.length > 0 && (
        <section aria-label="Claim evidence" className="space-y-2">
          <h2 className="text-base font-semibold">Evidence ({claim.evidence.length})</h2>
          <ul className="space-y-2">
            {claim.evidence.map((item, i) => (
              <li
                key={i}
                className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-medium text-primary underline-offset-2 hover:underline"
                    title={item.url}
                  >
                    {item.url.split('/').pop() || `Evidence ${i + 1}`}
                  </a>
                  <EvidenceVerifyButton url={item.url} storedHash={item.hash} />
                </div>
                <span
                  className="font-mono text-[10px] text-muted-foreground truncate"
                  title={item.hash}
                >
                  SHA-256: {item.hash.substring(0, 16)}…{item.hash.slice(-8)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Prior vote badge */}
      {alreadyVoted && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm"
        >
          {eligibility.priorVote === 'Approve' ? (
            <CheckCircle className="h-4 w-4 text-green-600" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
          )}
          <span>
            You voted{' '}
            <Badge
              variant={eligibility.priorVote === 'Approve' ? 'success' : 'destructive'}
              className="text-xs"
            >
              {eligibility.priorVote}
            </Badge>{' '}
            on this claim.
          </span>
        </div>
      )}

      {/* Simulation error */}
      {simError && (
        <div
          role="alert"
          className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900"
        >
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Pre-flight check failed: {simError}
        </div>
      )}

      {/* Post-vote tx link */}
      {submitState === 'done' && txHash && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Vote confirmed on-chain.</span>
          <a
            href={explorerUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 underline underline-offset-2"
            aria-label="View transaction on Stellar Explorer (opens in new tab)"
          >
            View on Explorer
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}

      {/* Appeal button for rejected claims */}
      {claim.status === 'Rejected' && !appealSubmitted && (
        <AppealButton
          claim={claim}
          walletAddress={walletAddress}
          submitting={appealState === 'signing' || appealState === 'submitting'}
          onClick={handleAppealClick}
          className="mt-4"
        />
      )}

      {/* Appeal error */}
      {appealError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Appeal error: {appealError}
        </div>
      )}

      {/* Post-appeal tx link */}
      {appealState === 'done' && appealTxHash && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Appeal submitted successfully. New voting window is now open.</span>
          <a
            href={explorerUrl(appealTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 underline underline-offset-2"
            aria-label="View transaction on Stellar Explorer (opens in new tab)"
          >
            View on Explorer
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}

      {/* Vote actions — sticky bar at bottom on mobile, inline on larger screens */}
      {!terminal && (
        <div
          className="sticky-action-bar bg-background/95 backdrop-blur-sm border-t pt-3 -mx-4 px-4 sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:pt-0 sm:mx-0 sm:px-0"
          role="group"
          aria-label="Cast your vote"
          data-tour="cast-vote"
        >
          {showVoteActions ? (
            <div className="flex gap-3">
              {/* Approve */}
              <div className="relative flex-1">
                <Button
                  className="w-full"
                  variant="default"
                  aria-label="Vote to approve this claim"
                  onClick={() => handleVoteClick('Approve')}
                >
                  <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                  Approve
                </Button>
              </div>

              {/* Reject */}
              <div className="relative flex-1">
                <Button
                  className="w-full"
                  variant="destructive"
                  aria-label="Vote to reject this claim"
                  onClick={() => handleVoteClick('Reject')}
                >
                  <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                  Reject
                </Button>
              </div>
            </div>
          ) : (
            <div
              role="status"
              className="rounded-xl border bg-muted p-4 text-sm text-muted-foreground"
              data-testid="claim-vote-unavailable"
            >
              {disabledTooltip ?? 'Voting actions are not available at this time.'}
            </div>
          )}
        </div>
      )}

      {/* Eligibility explanation for screen readers and visible hint */}
      {!showVoteActions && !terminal && disabledTooltip && (
        <p
          id="vote-ineligible-msg"
          role="note"
          className="text-xs text-muted-foreground"
        >
          {disabledTooltip}
        </p>
      )}

      {/* Eligibility loading */}
      {loadingEligibility && (
        <p className="text-xs text-muted-foreground" aria-busy="true">
          Checking eligibility…
        </p>
      )}

      {/* Confirmation modal */}
      <VoteConfirmModal
        open={submitState === 'confirming'}
        vote={pendingVote}
        claimId={claimId}
        claim={claim}
        submitting={submitState === 'signing' || submitState === 'submitting'}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* Appeal confirmation modal */}
      <AppealConfirmModal
        open={appealState === 'confirming'}
        claim={claim}
        submitting={appealState === 'signing' || appealState === 'submitting'}
        onConfirm={handleAppealConfirm}
        onCancel={handleAppealCancel}
      />
    </div>
  )
}
