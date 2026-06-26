'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, PlusCircle, ShieldAlert, Trash2 } from 'lucide-react'

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
import { adminApi, type AllowedAsset } from '@/lib/api/admin'

// ── JWT role helper (mirrors admin/page.tsx) ───────────────────────────────

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

// ── Root page ──────────────────────────────────────────────────────────────

export default function AdminAssetsPage() {
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
          <h1 className="text-2xl font-semibold">Asset Allowlist</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage SEP-41 assets that are permitted for use in policies and claims.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-primary underline underline-offset-4">
          ← Admin
        </Link>
      </div>
      <AssetAllowlistWidget jwt={jwt} />
    </main>
  )
}

// ── Asset allowlist widget ─────────────────────────────────────────────────

function AssetAllowlistWidget({ jwt }: { jwt: string }) {
  const [assets, setAssets] = useState<AllowedAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<AllowedAsset | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  function loadAssets() {
    setLoading(true)
    setError(null)
    adminApi
      .listAssets(jwt)
      .then(setAssets)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load assets'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAssets() }, [jwt]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleAllowed(asset: AllowedAsset) {
    setToggling(asset.id)
    try {
      const updated = await adminApi.setAssetAllowed(jwt, asset.id, !asset.isAllowed)
      setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setToggling(null)
    }
  }

  async function handleRemove(asset: AllowedAsset) {
    setToggling(asset.id)
    try {
      await adminApi.removeAsset(jwt, asset.id)
      setAssets((prev) => prev.filter((a) => a.id !== asset.id))
      setRemoveTarget(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setToggling(null)
    }
  }

  function handleAddSuccess(asset: AllowedAsset) {
    setAssets((prev) => [...prev, asset])
    setAddOpen(false)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Allowed Assets</CardTitle>
          <CardDescription>
            SEP-41 token contracts that policies and claims may reference.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          Add asset
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        )}

        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading assets" />
          </div>
        )}

        {!loading && assets.length === 0 && !error && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No assets configured yet. Add the first one above.
          </p>
        )}

        {assets.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Symbol', 'Contract ID', 'Decimals', 'Allowed', 'Actions'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono font-medium">{asset.symbol}</td>
                    <td className="px-3 py-2 font-mono text-xs truncate max-w-[16rem]" title={asset.contractId}>
                      {asset.contractId}
                    </td>
                    <td className="px-3 py-2 text-center">{asset.decimals}</td>
                    <td className="px-3 py-2">
                      <button
                        role="switch"
                        aria-checked={asset.isAllowed}
                        aria-label={`Toggle ${asset.symbol} allowed status`}
                        disabled={toggling === asset.id}
                        onClick={() => handleToggleAllowed(asset)}
                        className={[
                          'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
                          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50',
                          asset.isAllowed ? 'bg-primary' : 'bg-input',
                        ].join(' ')}
                      >
                        <span className="sr-only">{asset.isAllowed ? 'Allowed' : 'Blocked'}</span>
                        <span
                          aria-hidden="true"
                          className={[
                            'inline-block h-5 w-5 rounded-full bg-background shadow transition-transform',
                            asset.isAllowed ? 'translate-x-5' : 'translate-x-0',
                          ].join(' ')}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${asset.symbol}`}
                        disabled={toggling === asset.id}
                        onClick={() => setRemoveTarget(asset)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add asset dialog */}
        <AddAssetDialog
          open={addOpen}
          jwt={jwt}
          onClose={() => setAddOpen(false)}
          onSuccess={handleAddSuccess}
        />

        {/* Remove confirmation dialog */}
        <Dialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
          <DialogContent aria-labelledby="remove-title" aria-describedby="remove-desc">
            <DialogHeader>
              <DialogTitle id="remove-title">Remove asset</DialogTitle>
              <DialogDescription id="remove-desc">
                Are you sure you want to remove{' '}
                <strong>{removeTarget?.symbol}</strong> from the allowlist? Policies
                referencing this asset will no longer be able to process new claims.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemoveTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={toggling === removeTarget?.id}
                aria-busy={toggling === removeTarget?.id}
                onClick={() => removeTarget && handleRemove(removeTarget)}
              >
                {toggling === removeTarget?.id ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Removing…</>
                ) : (
                  'Remove'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ── Add asset dialog ───────────────────────────────────────────────────────

interface AddAssetDialogProps {
  open: boolean
  jwt: string
  onClose: () => void
  onSuccess: (asset: AllowedAsset) => void
}

function AddAssetDialog({ open, jwt, onClose, onSuccess }: AddAssetDialogProps) {
  const [contractId, setContractId] = useState('')
  const [symbol, setSymbol] = useState('')
  const [decimals, setDecimals] = useState('7')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setContractId('')
    setSymbol('')
    setDecimals('7')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const dec = parseInt(decimals, 10)
    if (!contractId.trim()) { setError('Contract ID is required'); return }
    if (!symbol.trim()) { setError('Symbol is required'); return }
    if (!Number.isFinite(dec) || dec < 0 || dec > 18) {
      setError('Decimals must be a number between 0 and 18')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const asset = await adminApi.addAsset(jwt, {
        contractId: contractId.trim(),
        symbol: symbol.trim().toUpperCase(),
        decimals: dec,
      })
      reset()
      onSuccess(asset)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add asset')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!submitting) { reset(); if (!v) onClose() } }}
    >
      <DialogContent aria-labelledby="add-asset-title" aria-describedby="add-asset-desc">
        <DialogHeader>
          <DialogTitle id="add-asset-title">Add allowed asset</DialogTitle>
          <DialogDescription id="add-asset-desc">
            Register a SEP-41 token contract as an allowed asset.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contract-id">Contract ID</Label>
            <Input
              id="contract-id"
              placeholder="C…"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              aria-required="true"
              aria-describedby={error ? 'add-error' : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              placeholder="USDC"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              aria-required="true"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="decimals">Decimals</Label>
            <Input
              id="decimals"
              type="number"
              min={0}
              max={18}
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
              aria-required="true"
            />
          </div>
          {error && (
            <p id="add-error" className="text-xs text-destructive" role="alert">{error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose() }} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Adding…</>
              ) : (
                'Add asset'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
