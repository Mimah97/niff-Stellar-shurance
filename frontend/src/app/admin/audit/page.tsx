'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Download, Loader2, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/hooks/useAuth'
import { adminApi, type AuditEntry } from '@/lib/api/admin'

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

const PAGE_SIZE = 20

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminAuditPage() {
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
        <Link href="/" className="text-primary underline underline-offset-4 text-sm">
          Return home
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Immutable record of all admin actions.{' '}
          <Link href="/admin" className="text-primary underline underline-offset-2">
            ← Back to Admin
          </Link>
        </p>
      </div>
      <AuditLogViewer jwt={jwt} />
    </main>
  )
}

// ── Audit Log Viewer ───────────────────────────────────────────────────────

interface FilterState {
  action: string
  actor: string
  dateFrom: string
  dateTo: string
}

function AuditLogViewer({ jwt }: { jwt: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterState>({
    action: '',
    actor: '',
    dateFrom: '',
    dateTo: '',
  })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    (f: FilterState, append = false, cur?: string) => {
      setLoading(true)
      adminApi
        .getAudits(jwt, {
          limit: PAGE_SIZE,
          action: f.action || undefined,
          actor: f.actor || undefined,
          dateFrom: f.dateFrom || undefined,
          dateTo: f.dateTo || undefined,
          cursor: cur,
        })
        .then((page) => {
          setEntries((prev) => (append ? [...prev, ...page.items] : page.items))
          setCursor(page.nextCursor)
          setHasMore(!!page.nextCursor)
          setError(null)
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load audit log'))
        .finally(() => setLoading(false))
    },
    [jwt],
  )

  // Initial load
  useEffect(() => {
    load(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  function handleFilterChange(next: FilterState) {
    setFilters(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(next), 300)
  }

  const exportUrl = adminApi.exportAuditsUrl(
    jwt,
    filters.action || undefined,
    filters.actor || undefined,
    filters.dateFrom || undefined,
    filters.dateTo || undefined,
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Entries</CardTitle>
          <CardDescription>Filter by actor, action, or date range.</CardDescription>
        </div>
        <a
          href={exportUrl}
          download="audit-log.csv"
          className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline"
          aria-label="Export audit log as CSV"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export CSV
        </a>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="filter-action" className="text-xs">Action</Label>
            <Input
              id="filter-action"
              placeholder="e.g. CLAIM_OVERRIDE"
              value={filters.action}
              onChange={(e) => handleFilterChange({ ...filters, action: e.target.value })}
              className="h-8 text-xs"
              aria-label="Filter by action type"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="filter-actor" className="text-xs">Actor address</Label>
            <Input
              id="filter-actor"
              placeholder="G…"
              value={filters.actor}
              onChange={(e) => handleFilterChange({ ...filters, actor: e.target.value })}
              className="h-8 font-mono text-xs"
              aria-label="Filter by actor address"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="filter-date-from" className="text-xs">From date</Label>
            <Input
              id="filter-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange({ ...filters, dateFrom: e.target.value })}
              className="h-8 text-xs"
              aria-label="Filter from date"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="filter-date-to" className="text-xs">To date</Label>
            <Input
              id="filter-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange({ ...filters, dateTo: e.target.value })}
              className="h-8 text-xs"
              aria-label="Filter to date"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {['Time', 'Actor', 'Action', 'Details'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap font-mono">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono truncate max-w-[10rem]" title={e.actor}>
                    {e.actor}
                  </td>
                  <td className="px-3 py-2 font-mono">{e.action}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[16rem]">
                    {JSON.stringify(e.payload)}
                  </td>
                </tr>
              ))}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    No audit entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        )}

        {hasMore && !loading && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(filters, true, cursor)}
          >
            Load more
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
