'use client'

import { useMemo, useState } from 'react'

/**
 * Governance proposals page.
 *
 * Lists protocol proposals (open, passed, rejected, executed) with tallies and
 * deadlines, exposes a detail view with a vote panel, and a create-proposal
 * form with a typed payload editor per proposal kind. Client-side payload
 * validation mirrors the contract's limits, and creation is disabled while the
 * proposer cooldown is active.
 */

type ProposalStatus = 'open' | 'passed' | 'rejected' | 'executed'

type ProposalKind = 'quorum' | 'voting_period' | 'fee_bps'

interface Proposal {
  id: number
  title: string
  kind: ProposalKind
  status: ProposalStatus
  forVotes: number
  againstVotes: number
  deadline: number
  currentValue: number
  proposedValue: number
}

interface PayloadField {
  key: string
  label: string
  min: number
  max: number
  unit: string
}

/** Contract limits per proposal kind. */
const PAYLOAD_FIELDS: Record<ProposalKind, PayloadField> = {
  quorum: { key: 'quorumBps', label: 'Quorum', min: 1, max: 10_000, unit: 'bps' },
  voting_period: { key: 'votingPeriod', label: 'Voting period', min: 60, max: 604_800, unit: 'seconds' },
  fee_bps: { key: 'feeBps', label: 'Protocol fee', min: 0, max: 1_000, unit: 'bps' },
}

const KIND_LABELS: Record<ProposalKind, string> = {
  quorum: 'Quorum',
  voting_period: 'Voting period',
  fee_bps: 'Protocol fee',
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  open: 'Open',
  passed: 'Passed',
  rejected: 'Rejected',
  executed: 'Executed',
}

const STATUS_STYLES: Record<ProposalStatus, string> = {
  open: 'bg-blue-100 text-blue-800',
  passed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  executed: 'bg-purple-100 text-purple-800',
}

const PROPOSALS: Proposal[] = [
  {
    id: 1,
    title: 'Raise quorum to 4000 bps',
    kind: 'quorum',
    status: 'open',
    forVotes: 1_250_000,
    againstVotes: 320_000,
    deadline: Date.now() + 1000 * 60 * 60 * 48,
    currentValue: 3_000,
    proposedValue: 4_000,
  },
  {
    id: 2,
    title: 'Shorten voting period to 3 days',
    kind: 'voting_period',
    status: 'passed',
    forVotes: 2_100_000,
    againstVotes: 150_000,
    deadline: Date.now() - 1000 * 60 * 60 * 24,
    currentValue: 604_800,
    proposedValue: 259_200,
  },
  {
    id: 3,
    title: 'Reduce protocol fee to 25 bps',
    kind: 'fee_bps',
    status: 'rejected',
    forVotes: 400_000,
    againstVotes: 900_000,
    deadline: Date.now() - 1000 * 60 * 60 * 72,
    currentValue: 30,
    proposedValue: 25,
  },
  {
    id: 4,
    title: 'Raise quorum to 3500 bps',
    kind: 'quorum',
    status: 'executed',
    forVotes: 1_800_000,
    againstVotes: 100_000,
    deadline: Date.now() - 1000 * 60 * 60 * 120,
    currentValue: 3_000,
    proposedValue: 3_500,
  },
]

/** Cooldown between proposal creations, in milliseconds. */
const PROPOSER_COOLDOWN_MS = 1000 * 60 * 60 * 24

function formatDeadline(deadline: number): string {
  const diff = deadline - Date.now()
  if (diff <= 0) return 'Ended'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  return days > 0 ? `${days}d ${hours % 24}h left` : `${hours}h left`
}

function formatCooldown(remaining: number): string {
  const hours = Math.floor(remaining / (1000 * 60 * 60))
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

function validatePayload(kind: ProposalKind, raw: string): string | null {
  const field = PAYLOAD_FIELDS[kind]
  if (raw.trim() === '') return `${field.label} is required`
  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return `${field.label} must be a whole number`
  }
  if (value < field.min || value > field.max) {
    return `${field.label} must be between ${field.min} and ${field.max} ${field.unit}`
  }
  return null
}

export default function GovernancePage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [kind, setKind] = useState<ProposalKind>('quorum')
  const [payload, setPayload] = useState('')
  const [title, setTitle] = useState('')
  const [lastCreatedAt, setLastCreatedAt] = useState<number | null>(null)
  const [now] = useState(() => Date.now())

  const selected = useMemo(
    () => PROPOSALS.find((p) => p.id === selectedId) ?? null,
    [selectedId],
  )

  const cooldownRemaining = lastCreatedAt
    ? Math.max(0, lastCreatedAt + PROPOSER_COOLDOWN_MS - now)
    : 0
  const inCooldown = cooldownRemaining > 0

  const payloadError = payload === '' ? null : validatePayload(kind, payload)
  const canCreate = !inCooldown && title.trim() !== '' && payload !== '' && payloadError === null

  const field = PAYLOAD_FIELDS[kind]

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Governance</h1>
        <p className="text-sm text-gray-600">
          Review protocol proposals, cast your vote, and submit new ones.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Proposals</h2>
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {PROPOSALS.map((proposal) => (
            <li key={proposal.id}>
              <button
                type="button"
                onClick={() => setSelectedId(proposal.id)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-gray-50"
              >
                <div className="space-y-1">
                  <p className="font-medium">{proposal.title}</p>
                  <p className="text-xs text-gray-500">
                    {KIND_LABELS[proposal.kind]} · {formatDeadline(proposal.deadline)}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-700">For {proposal.forVotes.toLocaleString()}</span>
                  <span className="text-red-700">Against {proposal.againstVotes.toLocaleString()}</span>
                  <span className={`rounded px-2 py-0.5 font-medium ${STATUS_STYLES[proposal.status]}`}>
                    {STATUS_LABELS[proposal.status]}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section className="space-y-4 rounded border border-gray-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">{selected.title}</h2>
              <p className="text-xs text-gray-500">
                {KIND_LABELS[selected.kind]} · {formatDeadline(selected.deadline)}
              </p>
            </div>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[selected.status]}`}>
              {STATUS_LABELS[selected.status]}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Current value</dt>
              <dd className="font-medium">
                {selected.currentValue.toLocaleString()} {PAYLOAD_FIELDS[selected.kind].unit}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Proposed value</dt>
              <dd className="font-medium">
                {selected.proposedValue.toLocaleString()} {PAYLOAD_FIELDS[selected.kind].unit}
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Cast your vote</h3>
            {selected.status === 'open' ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Vote for
                </button>
                <button
                  type="button"
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                >
                  Vote against
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Voting is closed for this proposal.</p>
            )}
          </div>
        </section>
      )}

      <section className="space-y-4 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">Create proposal</h2>

        {inCooldown && (
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
            You are in the proposer cooldown. Creation is disabled for another{' '}
            {formatCooldown(cooldownRemaining)}.
          </p>
        )}

        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={inCooldown}
              className="w-full rounded border border-gray-300 px-3 py-1.5 disabled:bg-gray-100"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Proposal kind</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as ProposalKind)
                setPayload('')
              }}
              disabled={inCooldown}
              className="w-full rounded border border-gray-300 px-3 py-1.5 disabled:bg-gray-100"
            >
              {(Object.keys(PAYLOAD_FIELDS) as ProposalKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">
              {field.label} ({field.unit})
            </span>
            <input
              type="number"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              disabled={inCooldown}
              min={field.min}
              max={field.max}
              className="w-full rounded border border-gray-300 px-3 py-1.5 disabled:bg-gray-100"
            />
            <span className="text-xs text-gray-500">
              Allowed range: {field.min}–{field.max} {field.unit}
            </span>
            {payloadError && <span className="block text-xs text-red-600">{payloadError}</span>}
          </label>

          <button
            type="button"
            disabled={!canCreate}
            onClick={() => setLastCreatedAt(Date.now())}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Submit proposal
          </button>
        </div>
      </section>
    </div>
  )
}
