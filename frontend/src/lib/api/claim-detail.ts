import { z } from 'zod'

export const ClaimMetadataSchema = z.object({
  id: z.number(),
  policyId: z.string(),
  creatorAddress: z.string(),
  status: z.enum(['pending', 'approved', 'paid', 'rejected', 'appeal']),
  amount: z.string(),
  description: z.string().optional(),
  evidenceHash: z.string(),
  createdAtLedger: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const VoteTalliesSchema = z.object({
  yesVotes: z.number(),
  noVotes: z.number(),
  totalVotes: z.number(),
})

export const QuorumSchema = z.object({
  required: z.number(),
  current: z.number(),
  percentage: z.number(),
  reached: z.boolean(),
  quorum_progress_pct: z.number(),
  votes_needed: z.number(),
})

export const DeadlineSchema = z.object({
  votingDeadlineLedger: z.number(),
  votingDeadlineTime: z.string(),
  isOpen: z.boolean(),
  remainingSeconds: z.number().nullable(),
  deadline_estimate_utc: z.string(),
})

export const ClaimEvidenceSchema = z.object({
  gatewayUrl: z.string().url(),
  hash: z.string(),
})

export const ConsistencyMetadataSchema = z.object({
  isFinalized: z.boolean(),
  indexerLag: z.number().optional(),
  lastIndexedLedger: z.number().optional(),
  isStale: z.boolean(),
})

export const ClaimStatusHistoryEntrySchema = z.object({
  status: z.enum(['pending', 'approved', 'paid', 'rejected', 'appeal']),
  ledger: z.number(),
  timestamp: z.string(),
})

export const AppealInfoSchema = z.object({
  appealRound: z.number(),
  elevatedQuorumBps: z.number(),
  appealVotingDeadlineLedger: z.number(),
  appealVotingDeadlineTime: z.string().optional(),
})

export const DisputeInfoSchema = z.object({
  disputeDeadlineLedger: z.number().optional(),
  disputeDeadlineTime: z.string().optional(),
  disputeWindowOpen: z.boolean().optional(),
  remainingDisputeSeconds: z.number().nullable().optional(),
  disputeNote: z.string().optional(),
})

export const ClaimDetailResponseSchema = z.object({
  metadata: ClaimMetadataSchema,
  votes: VoteTalliesSchema,
  quorum: QuorumSchema,
  deadline: DeadlineSchema,
  dispute: DisputeInfoSchema,
  appeal: AppealInfoSchema.optional(),
  evidence: ClaimEvidenceSchema,
  consistency: ConsistencyMetadataSchema,
  status_history: z.array(ClaimStatusHistoryEntrySchema),
  voter_eligible: z.boolean(),
  userHasVoted: z.boolean().optional(),
  userVote: z.enum(['yes', 'no']).optional(),
  payout_deadline_ledger: z.number().optional(),
})

export type DisputeInfo = z.infer<typeof DisputeInfoSchema>

export type AppealInfo = z.infer<typeof AppealInfoSchema>

export type ClaimDetailResponse = z.infer<typeof ClaimDetailResponseSchema>

export async function fetchClaimDetail(claimId: string): Promise<ClaimDetailResponse> {
  const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}`)
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Failed to load claim details' }))
    throw new Error(errorBody.message ?? 'Failed to load claim details')
  }

  const data = await response.json()
  return ClaimDetailResponseSchema.parse(data)
}
