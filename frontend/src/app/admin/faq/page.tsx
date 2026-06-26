'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Loader2, Pencil, ShieldAlert, Trash2 } from 'lucide-react'

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
import {
  type FaqItem,
  listFaqItems,
  createFaqItem,
  updateFaqItem,
  deleteFaqItem,
  reorderFaqItems,
} from '@/lib/api/support'

// ── JWT role helper (same pattern as admin/claims/page.tsx) ────────────────

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: string
      isAdmin?: boolean
    }
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

// ── Root page ──────────────────────────────────────────────────────────────

export default function AdminFaqPage() {
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
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">FAQ Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create, edit, reorder, and delete FAQ entries shown on the public support page.{' '}
          <Link href="/admin" className="text-primary underline underline-offset-2">
            ← Back to Admin
          </Link>
        </p>
      </div>
      <FaqDashboard jwt={jwt} />
    </main>
  )
}

// ── FAQ Dashboard ──────────────────────────────────────────────────────────

function FaqDashboard({ jwt }: { jwt: string }) {
  const [items, setItems] = useState<FaqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  const [editItem, setEditItem] = useState<FaqItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FaqItem | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    listFaqItems()
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load FAQ items'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleMove(index: number, direction: 'up' | 'down') {
    const next = [...items]
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= next.length) return
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
    const reordered = next.map((item, i) => ({ ...item, displayOrder: i }))
    setItems(reordered)
    setReordering(true)
    try {
      await reorderFaqItems(
        jwt,
        reordered.map((item) => ({ id: item.id, displayOrder: item.displayOrder })),
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reorder failed')
      load()
    } finally {
      setReordering(false)
    }
  }

  async function handleDelete(item: FaqItem) {
    try {
      await deleteFaqItem(jwt, item.id)
      setDeleteTarget(null)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} size="sm">
          + New FAQ entry
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>FAQ Entries</CardTitle>
          <CardDescription>
            Drag the up/down arrows to reorder. Changes are saved immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No FAQ entries yet. Click &quot;+ New FAQ entry&quot; to add the first one.
            </p>
          ) : (
            <ul className="divide-y" aria-label="FAQ entries">
              {items.map((item, index) => (
                <li key={item.id} className="flex items-start gap-3 py-3">
                  {/* Reorder controls */}
                  <div className="flex flex-col gap-0.5 pt-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMove(index, 'up')}
                      disabled={index === 0 || reordering}
                      className="rounded p-0.5 hover:bg-muted disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label={`Move "${item.question}" up`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(index, 'down')}
                      disabled={index === items.length - 1 || reordering}
                      className="rounded p-0.5 hover:bg-muted disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label={`Move "${item.question}" down`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{item.category}</p>
                    <p className="text-sm font-medium leading-snug">{item.question}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.answer}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setEditItem(item)}
                      aria-label={`Edit "${item.question}"`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(item)}
                      aria-label={`Delete "${item.question}"`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <FaqFormDialog
        open={createOpen}
        title="New FAQ entry"
        description="Add a new question and answer to the public support page."
        onClose={() => setCreateOpen(false)}
        onSave={async (data) => {
          await createFaqItem(jwt, data)
          setCreateOpen(false)
          load()
        }}
      />

      {/* Edit dialog */}
      <FaqFormDialog
        open={!!editItem}
        title="Edit FAQ entry"
        description="Update the question, answer, or category."
        initialValues={editItem ?? undefined}
        onClose={() => setEditItem(null)}
        onSave={async (data) => {
          if (!editItem) return
          await updateFaqItem(jwt, editItem.id, data)
          setEditItem(null)
          load()
        }}
      />

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent aria-labelledby="del-title" aria-describedby="del-desc">
          <DialogHeader>
            <DialogTitle id="del-title">Delete FAQ entry</DialogTitle>
            <DialogDescription id="del-desc">
              Are you sure you want to delete this entry? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <p className="text-sm font-medium">&ldquo;{deleteTarget.question}&rdquo;</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Shared form dialog ─────────────────────────────────────────────────────

interface FaqFormValues {
  question: string
  answer: string
  category: string
}

interface FaqFormDialogProps {
  open: boolean
  title: string
  description: string
  initialValues?: Partial<FaqFormValues>
  onClose: () => void
  onSave: (data: FaqFormValues) => Promise<void>
}

function FaqFormDialog({ open, title, description, initialValues, onClose, onSave }: FaqFormDialogProps) {
  const [question, setQuestion] = useState(initialValues?.question ?? '')
  const [answer, setAnswer] = useState(initialValues?.answer ?? '')
  const [category, setCategory] = useState(initialValues?.category ?? 'General')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const prevInitialRef = useRef(initialValues)

  useEffect(() => {
    if (open && initialValues !== prevInitialRef.current) {
      prevInitialRef.current = initialValues
      setQuestion(initialValues?.question ?? '')
      setAnswer(initialValues?.answer ?? '')
      setCategory(initialValues?.category ?? 'General')
      setFormError(null)
    }
    if (!open) {
      setQuestion(initialValues?.question ?? '')
      setAnswer(initialValues?.answer ?? '')
      setCategory(initialValues?.category ?? 'General')
      setFormError(null)
    }
  }, [open, initialValues])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim() || !answer.trim()) {
      setFormError('Question and answer are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await onSave({ question: question.trim(), answer: answer.trim(), category: category.trim() || 'General' })
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && !v && onClose()}>
      <DialogContent aria-labelledby="faq-form-title" aria-describedby="faq-form-desc">
        <DialogHeader>
          <DialogTitle id="faq-form-title">{title}</DialogTitle>
          <DialogDescription id="faq-form-desc">{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="faq-category">Category</Label>
            <Input
              id="faq-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. General, Claims, Pricing"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="faq-question">
              Question <span className="text-destructive">*</span>
            </Label>
            <Input
              id="faq-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What is…?"
              aria-required="true"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="faq-answer">
              Answer <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="faq-answer"
              rows={5}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Provide a clear, concise answer…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-required="true"
            />
          </div>

          {formError && (
            <p className="text-xs text-destructive" role="alert">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
