import { useCallback, useEffect, useMemo, useState } from 'react';

export type ProposalStatus = 'open' | 'passed' | 'rejected' | 'executed';

export type ProposalKind =
  | 'quorum_bps'
  | 'voting_period'
  | 'min_proposal_deposit'
  | 'treasury_spend';

export interface ProposalPayload {
  kind: ProposalKind;
  value: number;
  recipient?: string;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  status: ProposalStatus;
  payload: ProposalPayload;
  currentValue: number;
  votesFor: number;
  votesAgainst: number;
  deadline: number;
  createdAt: number;
}

export interface GovernanceLimits {
  quorumBps: { min: number; max: number };
  votingPeriod: { min: number; max: number };
  minProposalDeposit: { min: number; max: number };
}

export const GOVERNANCE_LIMITS: GovernanceLimits = {
  quorumBps: { min: 1, max: 10_000 },
  votingPeriod: { min: 60, max: 604_800 },
  minProposalDeposit: { min: 0, max: 1_000_000 },
};

export const PROPOSER_COOLDOWN_SECONDS = 86_400;

export interface CreateProposalInput {
  title: string;
  description: string;
  payload: ProposalPayload;
}

export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<'title' | 'description' | 'value' | 'recipient', string>>;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function validateProposalPayload(payload: ProposalPayload): ValidationResult {
  const errors: ValidationResult['errors'] = {};

  switch (payload.kind) {
    case 'quorum_bps': {
      const { min, max } = GOVERNANCE_LIMITS.quorumBps;
      if (!isFiniteNumber(payload.value) || !Number.isInteger(payload.value)) {
        errors.value = 'Quorum must be a whole number of basis points.';
      } else if (payload.value < min || payload.value > max) {
        errors.value = `Quorum must be between ${min} and ${max} bps.`;
      }
      break;
    }
    case 'voting_period': {
      const { min, max } = GOVERNANCE_LIMITS.votingPeriod;
      if (!isFiniteNumber(payload.value) || !Number.isInteger(payload.value)) {
        errors.value = 'Voting period must be a whole number of seconds.';
      } else if (payload.value < min || payload.value > max) {
        errors.value = `Voting period must be between ${min} and ${max} seconds.`;
      }
      break;
    }
    case 'min_proposal_deposit': {
      const { min, max } = GOVERNANCE_LIMITS.minProposalDeposit;
      if (!isFiniteNumber(payload.value) || payload.value < min || payload.value > max) {
        errors.value = `Deposit must be between ${min} and ${max}.`;
      }
      break;
    }
    case 'treasury_spend': {
      if (!isFiniteNumber(payload.value) || payload.value <= 0) {
        errors.value = 'Spend amount must be greater than zero.';
      }
      if (!payload.recipient || payload.recipient.trim().length === 0) {
        errors.recipient = 'A recipient address is required.';
      }
      break;
    }
    default:
      errors.value = 'Unsupported proposal kind.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateCreateProposal(input: CreateProposalInput): ValidationResult {
  const errors: ValidationResult['errors'] = {};

  if (!input.title || input.title.trim().length < 3) {
    errors.title = 'Title must be at least 3 characters.';
  }
  if (!input.description || input.description.trim().length < 10) {
    errors.description = 'Description must be at least 10 characters.';
  }

  const payloadResult = validateProposalPayload(input.payload);
  Object.assign(errors, payloadResult.errors);

  return { valid: Object.keys(errors).length === 0, errors };
}

export interface CooldownState {
  active: boolean;
  remainingSeconds: number;
  reason: string | null;
}

export function computeCooldown(
  lastProposalAt: number | null,
  now: number = Date.now(),
): CooldownState {
  if (!lastProposalAt) {
    return { active: false, remainingSeconds: 0, reason: null };
  }

  const elapsed = Math.floor((now - lastProposalAt) / 1000);
  const remaining = PROPOSER_COOLDOWN_SECONDS - elapsed;

  if (remaining <= 0) {
    return { active: false, remainingSeconds: 0, reason: null };
  }

  return {
    active: true,
    remainingSeconds: remaining,
    reason: `You can create another proposal in ${formatDuration(remaining)}.`,
  };
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export interface UseGovernanceResult {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  cooldown: CooldownState;
  createProposal: (input: CreateProposalInput) => Promise<Proposal>;
  vote: (proposalId: string, support: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useGovernance(): UseGovernanceResult {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProposalAt, setLastProposalAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const cooldown = useMemo(
    () => computeCooldown(lastProposalAt, now),
    [lastProposalAt, now],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/governance/proposals');
      if (!response.ok) throw new Error('Failed to load proposals');
      const data = (await response.json()) as Proposal[];
      setProposals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProposal = useCallback(
    async (input: CreateProposalInput): Promise<Proposal> => {
      const validation = validateCreateProposal(input);
      if (!validation.valid) {
        throw new Error(Object.values(validation.errors)[0] ?? 'Invalid proposal');
      }
      if (cooldown.active) {
        throw new Error(cooldown.reason ?? 'Proposer cooldown active');
      }

      const response = await fetch('/api/governance/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Failed to create proposal');

      const created = (await response.json()) as Proposal;
      setProposals((prev) => [created, ...prev]);
      setLastProposalAt(Date.now());
      return created;
    },
    [cooldown],
  );

  const vote = useCallback(async (proposalId: string, support: boolean) => {
    const response = await fetch(`/api/governance/proposals/${proposalId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ support }),
    });
    if (!response.ok) throw new Error('Failed to cast vote');

    const updated = (await response.json()) as Proposal;
    setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  return { proposals, loading, error, cooldown, createProposal, vote, refresh };
}
