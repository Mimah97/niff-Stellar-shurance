import type { Metadata } from 'next'

import { ErrorCodesTable } from '@/components/support/error-codes-table'

export const metadata: Metadata = {
  title: 'Error Code Reference — NiffyInsur',
  description: 'Human-readable descriptions, common causes, and resolution steps for all NiffyInsur API error codes.',
}

export default function ErrorCodesPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Error Code Reference</h1>
        <p className="text-muted-foreground">
          Human-readable descriptions, common causes, and resolution steps for all API error codes.
        </p>
      </div>
      <ErrorCodesTable />
    </main>
  )
}
