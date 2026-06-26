'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatXlm } from '@/lib/formatTokenAmount'
import { fetchClaimDetail, type ClaimDetailResponse } from '@/lib/api/claim-detail'
import { useLatestLedger } from '@/hooks/use-latest-ledger'
import { DeadlineCountdown } from './DeadlineCountdown'
import { QuorumProgressBar } from './QuorumProgressBar'
import { ClaimVotePanel } from './claim-vote-panel'

interface ClaimDetailViewProps {
  claimId: string
}

function getStatusVariant(status: ClaimDetailResponse['metadata']['status']) {
  switch (status) {
    case 'approved':
    case 'paid':
      return 'success'
    case 'rejected':
      return 'destructive'
    case 'appeal':
      return 'warning'
    case 'pending':
    default:
      return 'info'
  }
}

function formatStatusLabel(status: ClaimDetailResponse['metadata']['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function isImageEvidence(url: string) {
  return /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(url)
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export function ClaimDetailView({ claimId }: ClaimDetailViewProps) {
  const latestLedger = useLatestLedger()
  const {
    data: claim,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['claim-detail', claimId],
    queryFn: () => fetchClaimDetail(claimId),
    retry: false,
  })

  const votePercentages = useMemo(() => {
    const yes = claim?.votes.yesVotes ?? 0
    const no = claim?.votes.noVotes ?? 0
    const total = yes + no
    const approvePct = total > 0 ? Math.round((yes / total) * 100) : 0
    const rejectPct = total > 0 ? Math.round((no / total) * 100) : 0
    return { approvePct, rejectPct }
  }, [claim])

  if (isLoading) {
    return (
      <section aria-label="Claim details" aria-busy="true" className="space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent>
              <div className="space-y-4">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-44 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    )
  }

  if (isError || !claim) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Claim details unavailable</CardTitle>
          <CardDescription>We could not load the claim details right now. Please try again later.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const evidenceUrl = claim.evidence.gatewayUrl
  const evidencePreview = isImageEvidence(evidenceUrl)
  const totalVotes = claim.votes.yesVotes + claim.votes.noVotes

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold">Claim {claimId}</h1>
                  <Badge variant={getStatusVariant(claim.metadata.status)}>
                    {formatStatusLabel(claim.metadata.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Filed by {claim.metadata.creatorAddress} on {formatTimestamp(claim.metadata.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Requested payout</p>
                <p className="text-3xl font-semibold tabular-nums">
                  {formatXlm(claim.metadata.amount)} XLM
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Claim summary</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {claim.metadata.description ?? 'No description provided.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Policy</p>
                <p className="text-sm font-medium">{claim.metadata.policyId}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Last updated</p>
                <p className="text-sm font-medium">{formatTimestamp(claim.metadata.updatedAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
            <CardDescription>Evidence is rendered through the approved gateway and never uses raw IPFS URLs directly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {evidencePreview ? (
              <img
                src={evidenceUrl}
                alt="Claim evidence preview"
                className="h-80 w-full rounded-xl border object-contain"
                data-testid="claim-evidence-preview"
              />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Evidence is available through the approved gateway.
                </p>
                <Button
                  asChild
                  variant="secondary"
                  className="inline-flex gap-2"
                >
                  <a
                    href={evidenceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    download
                    data-testid="claim-evidence-download"
                  >
                    Download evidence
                  </a>
                </Button>
              </div>
            )}
            {!evidencePreview && evidenceUrl && (
              <p className="text-xs text-muted-foreground">
                Evidence file served via gateway: {claim.evidence.hash}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voting and quorum</CardTitle>
            <CardDescription>Live vote tallies and quorum progress for this claim.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-muted p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Approve votes</p>
                <p className="mt-2 text-2xl font-semibold text-green-600 tabular-nums">{claim.votes.yesVotes}</p>
              </div>
              <div className="rounded-xl border bg-muted p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Reject votes</p>
                <p className="mt-2 text-2xl font-semibold text-red-600 tabular-nums">{claim.votes.noVotes}</p>
              </div>
              <div className="rounded-xl border bg-muted p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Total ballots</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{totalVotes}</p>
              </div>
            </div>

            <div className="space-y-4">
              <QuorumProgressBar
                approvePct={votePercentages.approvePct}
                rejectPct={votePercentages.rejectPct}
                quorumThresholdPct={claim.quorum.percentage}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border bg-muted p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Votes needed</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">{claim.quorum.votes_needed}</p>
                </div>
                <div className="rounded-xl border bg-muted p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Quorum reached</p>
                  <p className="mt-2 text-lg font-semibold text-{claim.quorum.reached ? 'green-600' : 'muted-foreground'}">
                    {claim.quorum.reached ? 'Yes' : 'No'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {claim.metadata.status === 'appeal' && claim.appeal && (
          <Card>
            <CardHeader>
              <CardTitle>Appeal in progress</CardTitle>
              <CardDescription>This claim is under appeal review with elevated quorum requirements.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border bg-amber-50 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Appeal round</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{claim.appeal.appealRound}</p>
                </div>
                <div className="rounded-xl border bg-amber-50 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Elevated quorum</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {(claim.appeal.elevatedQuorumBps / 100).toFixed(2)}%
                  </p>
                  <p className="text-xs text-muted-foreground">{claim.appeal.elevatedQuorumBps} bps</p>
                </div>
                <div className="rounded-xl border bg-amber-50 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Appeal deadline ledger</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{claim.appeal.appealVotingDeadlineLedger}</p>
                </div>
              </div>
              {claim.appeal.appealVotingDeadlineTime && (
                <div className="rounded-xl border bg-muted p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Appeal voting deadline</p>
                  <p className="mt-1 text-sm font-medium">{formatTimestamp(claim.appeal.appealVotingDeadlineTime)}</p>
                </div>
              )}
              <div className="rounded-xl border bg-muted p-4">
                {latestLedger !== null ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-muted-foreground">Time remaining for appeal vote</span>
                    <DeadlineCountdown
                      deadlineLedger={claim.appeal.appealVotingDeadlineLedger}
                      currentLedger={latestLedger}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Fetching latest ledger…</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {claim.metadata.status === 'approved' && claim.dispute.disputeWindowOpen && (
          <Card>
            <CardHeader>
              <CardTitle>Dispute window</CardTitle>
              <CardDescription>Payout will auto-execute once this window expires.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Auto-execute ledger</p>
                  <p className="text-lg font-semibold tabular-nums">{claim.dispute.disputeDeadlineLedger}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Auto-execute estimate</p>
                  <p className="text-lg font-semibold">{claim.dispute.disputeDeadlineTime ? formatTimestamp(claim.dispute.disputeDeadlineTime) : '—'}</p>
                </div>
              </div>
              <div className="rounded-xl border bg-amber-50 p-4">
                {latestLedger !== null ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-amber-800">Time before auto-execution</span>
                    <DeadlineCountdown
                      deadlineLedger={claim.dispute.disputeDeadlineLedger ?? 0}
                      currentLedger={latestLedger}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Fetching latest ledger…</p>
                )}
              </div>
              {claim.dispute.disputeNote && (
                <div className="rounded-xl border bg-blue-50 p-3">
                  <p className="text-sm text-blue-800 flex items-center gap-2">
                    <span className="text-lg" aria-hidden="true">&#9432;</span>
                    {claim.dispute.disputeNote}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Voting deadline</CardTitle>
            <CardDescription>Ledger-based deadline with live countdown synced to horizon.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Deadline ledger</p>
                <p className="text-lg font-semibold tabular-nums">{claim.deadline.votingDeadlineLedger}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Deadline estimate</p>
                <p className="text-lg font-semibold">{formatTimestamp(claim.deadline.votingDeadlineTime)}</p>
              </div>
            </div>
            <div className="rounded-xl border bg-muted p-4">
              {latestLedger !== null ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-muted-foreground">Estimated remaining</span>
                  <DeadlineCountdown deadlineLedger={claim.deadline.votingDeadlineLedger} currentLedger={latestLedger} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Fetching latest ledger from Horizon…</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
            <CardDescription>On-chain status transitions with ledger numbers and estimated timestamps.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative ml-3 border-l-2 border-gray-200" aria-label="Status timeline">
              {claim.status_history.map((entry, index) => {
                const isLatest = index === claim.status_history.length - 1
                const variant = getStatusVariant(entry.status)
                const dotColor =
                  variant === 'success'
                    ? 'bg-green-500'
                    : variant === 'destructive'
                      ? 'bg-red-500'
                      : 'bg-blue-500'

                return (
                  <li key={`${entry.status}-${entry.ledger}`} className="relative mb-6 ml-6 last:mb-0">
                    <span
                      className={`absolute -left-[31px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-background ${dotColor}`}
                      aria-hidden="true"
                    />
                    <div className={`rounded-lg border p-3 ${isLatest ? 'border-primary/30 bg-primary/5' : 'bg-muted'}`}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant={getStatusVariant(entry.status)}>
                            {formatStatusLabel(entry.status)}
                          </Badge>
                          {isLatest && (
                            <span className="text-xs font-medium text-primary">(Current)</span>
                          )}
                        </div>
                        <time className="text-xs text-muted-foreground" dateTime={entry.timestamp}>
                          {formatTimestamp(entry.timestamp)}
                        </time>
                      </div>
                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        Ledger #{entry.ledger.toLocaleString()}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Vote on claim</CardTitle>
            <CardDescription>Cast your vote and follow claim progress.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClaimVotePanel claimId={claimId} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Indexer status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Indexer lag: {claim.consistency.indexerLag ?? 0} ledgers</p>
            <p>Last indexed ledger: {claim.consistency.lastIndexedLedger ?? 'unknown'}</p>
            <p>{claim.consistency.isStale ? 'Data may be stale.' : 'Indexer data is fresh.'}</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
