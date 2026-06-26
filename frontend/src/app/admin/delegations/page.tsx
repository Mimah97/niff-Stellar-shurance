'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, PlusCircle, ShieldAlert, Trash2, UserCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/hooks/useAuth'
import { adminApi, type OperatorDelegation } from '@/lib/api/admin'

const LEDGER_CLOSE_SECONDS = 5

// ── JWT role helper ────────────────────────────────────────────────────────

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function formatCountdown(ledgersRemaining: number): string {
  if (ledgersRemaining <= 0) return 'Expired'
  const seconds = ledgersRemaining * LEDGER_CLOSE_SECONDS
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// ── Root page ──────────────────────────────────────────────────────────────

export default function AdminDelegationsPage() {
  const { jwt } = useAuth()
  const staff = isStaff(jwt)

  if (!jwt) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Authentication required</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet and sign in to continue.</p>
      </main>
    )
  }

  if (!staff) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-6xl font-bold text-destructive">403</p>
        <h1 className="text-2xl font-semibold">Access denied</h1>
        <p className="text-muted-foreground max-w-sm">
          You do not have permission to view this page. Staff authentication is required.
        </p>
        <Link href="/admin" className="text-primary underline underline-offset-4 text-sm">
          Back to Admin
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Delegation Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Grant and revoke temporary operator roles with ledger-based expiry.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-primary underline underline-offset-4">
          ← Admin
        </Link>
      </div>
      <DelegationsWidget jwt={jwt} />
    </main>
  )
}

// ── Delegations widget ─────────────────────────────────────────────────────

function DelegationsWidget({ jwt }: { jwt: string }) {
  const [delegations, setDelegations] = useState<OperatorDelegation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<OperatorDelegation | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  function loadDelegations() {
    setLoading(true)
    setError(null)
    adminApi
      .listDelegations(jwt)
      .then(setDelegations)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load delegations'),
      )
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDelegations() }, [jwt]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRevoke(delegation: OperatorDelegation) {
    setRevoking(delegation.id)
    try {
      await adminApi.revokeDelegation(jwt, delegation.id)
      setDelegations((prev) => prev.filter((d) => d.id !== delegation.id))
      setRevokeTarget(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Revoke failed')
    } finally {
      setRevoking(null)
    }
  }

  function handleGrantSuccess(delegation: OperatorDelegation) {
    setDelegations((prev) => [...prev, delegation])
    setGrantOpen(false)
  }

  const activeDelegations = delegations.filter((d) => d.ledgersRemaining > 0)
  const expiredDelegations = delegations.filter((d) => d.ledgersRemaining <= 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" aria-hidden="true" />
            Active Delegations
          </CardTitle>
          <CardDescription>
            Temporary operator grants. Expired grants are retained for the audit trail.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setGrantOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          Grant delegation
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        )}

        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading delegations" />
          </div>
        )}

        {!loading && delegations.length === 0 && !error && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No delegations found. Grant the first one above.
          </p>
        )}

        {/* Active delegations */}
        {activeDelegations.length > 0 && (
          <DelegationTable
            delegations={activeDelegations}
            revoking={revoking}
            onRevoke={setRevokeTarget}
          />
        )}

        {/* Expired delegations (collapsed, shown for audit) */}
        {expiredDelegations.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground select-none list-none flex items-center gap-1">
              <span className="group-open:hidden">▶</span>
              <span className="hidden group-open:inline">▼</span>
              {expiredDelegations.length} expired delegation{expiredDelegations.length !== 1 ? 's' : ''}
            </summary>
            <div className="mt-3">
              <DelegationTable
                delegations={expiredDelegations}
                revoking={revoking}
                onRevoke={setRevokeTarget}
                muted
              />
            </div>
          </details>
        )}

        {/* Grant delegation dialog */}
        <GrantDelegationDialog
          open={grantOpen}
          jwt={jwt}
          onClose={() => setGrantOpen(false)}
          onSuccess={handleGrantSuccess}
        />

        {/* Revoke confirmation dialog */}
        <Dialog open={!!revokeTarget} onOpenChange={(v) => !v && setRevokeTarget(null)}>
          <DialogContent aria-labelledby="revoke-title" aria-describedby="revoke-desc">
            <DialogHeader>
              <DialogTitle id="revoke-title">Revoke delegation</DialogTitle>
              <DialogDescription id="revoke-desc">
                This will immediately revoke the operator role for{' '}
                <strong className="font-mono break-all">{revokeTarget?.delegate}</strong>.
                The delegate will no longer be able to perform operator actions.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevokeTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={revoking === revokeTarget?.id}
                aria-busy={revoking === revokeTarget?.id}
                onClick={() => revokeTarget && handleRevoke(revokeTarget)}
              >
                {revoking === revokeTarget?.id ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Revoking…</>
                ) : (
                  'Revoke'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ── Delegation table ───────────────────────────────────────────────────────

interface DelegationTableProps {
  delegations: OperatorDelegation[]
  revoking: string | null
  onRevoke: (d: OperatorDelegation) => void
  muted?: boolean
}

function DelegationTable({ delegations, revoking, onRevoke, muted }: DelegationTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className={['w-full text-sm', muted ? 'opacity-60' : ''].join(' ')}>
        <thead className="bg-muted/50">
          <tr>
            {['Delegate', 'Expiry ledger', 'Time remaining', 'Granted by', 'Granted at', ''].map(
              (h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {delegations.map((d) => (
            <tr key={d.id} className="hover:bg-muted/30">
              <td
                className="px-3 py-2 font-mono text-xs truncate max-w-[12rem]"
                title={d.delegate}
              >
                {d.delegate}
              </td>
              <td className="px-3 py-2 font-mono">{d.expiryLedger.toLocaleString()}</td>
              <td
                className={[
                  'px-3 py-2 font-medium',
                  d.ledgersRemaining <= 0
                    ? 'text-muted-foreground'
                    : d.ledgersRemaining < 1000
                    ? 'text-yellow-600'
                    : 'text-green-600',
                ].join(' ')}
              >
                {formatCountdown(d.ledgersRemaining)}
              </td>
              <td
                className="px-3 py-2 font-mono text-xs truncate max-w-[12rem]"
                title={d.grantedBy}
              >
                {d.grantedBy}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(d.grantedAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2">
                {d.ledgersRemaining > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Revoke delegation for ${d.delegate}`}
                    disabled={revoking === d.id}
                    onClick={() => onRevoke(d)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Grant delegation dialog ────────────────────────────────────────────────

interface GrantDelegationDialogProps {
  open: boolean
  jwt: string
  onClose: () => void
  onSuccess: (delegation: OperatorDelegation) => void
}

function GrantDelegationDialog({ open, jwt, onClose, onSuccess }: GrantDelegationDialogProps) {
  const [delegate, setDelegate] = useState('')
  const [expiryLedger, setExpiryLedger] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setDelegate('')
    setExpiryLedger('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const ledger = parseInt(expiryLedger, 10)
    if (!delegate.trim()) { setError('Delegate address is required'); return }
    if (!Number.isFinite(ledger) || ledger <= 0) {
      setError('Expiry ledger must be a positive integer')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const delegation = await adminApi.grantDelegation(jwt, {
        delegate: delegate.trim(),
        expiryLedger: ledger,
      })
      reset()
      onSuccess(delegation)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to grant delegation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!submitting) { reset(); if (!v) onClose() } }}
    >
      <DialogContent aria-labelledby="grant-title" aria-describedby="grant-desc">
        <DialogHeader>
          <DialogTitle id="grant-title">Grant operator delegation</DialogTitle>
          <DialogDescription id="grant-desc">
            Assign a temporary operator role to a Stellar address. The grant expires at
            the specified ledger number.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="delegate-address">Delegate address</Label>
            <Input
              id="delegate-address"
              placeholder="G…"
              value={delegate}
              onChange={(e) => setDelegate(e.target.value)}
              aria-required="true"
              aria-describedby={error ? 'grant-error' : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expiry-ledger">Expiry ledger</Label>
            <Input
              id="expiry-ledger"
              type="number"
              min={1}
              placeholder="e.g. 5000000"
              value={expiryLedger}
              onChange={(e) => setExpiryLedger(e.target.value)}
              aria-required="true"
            />
            <p className="text-xs text-muted-foreground">
              The delegation expires when the Stellar network reaches this ledger sequence.
            </p>
          </div>
          {error && (
            <p id="grant-error" className="text-xs text-destructive" role="alert">{error}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { reset(); onClose() }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Granting…</>
              ) : (
                'Grant delegation'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
