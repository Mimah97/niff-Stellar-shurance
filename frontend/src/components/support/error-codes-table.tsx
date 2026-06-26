'use client'

import { useState } from 'react'

import { ERROR_CATALOG } from '@/lib/errors'

export function ErrorCodesTable() {
  const [query, setQuery] = useState('')
  const q = query.toLowerCase().trim()

  const filtered = q
    ? ERROR_CATALOG.filter(
        (e) =>
          e.code.toLowerCase().includes(q) ||
          e.message.toLowerCase().includes(q) ||
          e.causes.some((c) => c.toLowerCase().includes(q)) ||
          e.resolution.toLowerCase().includes(q),
      )
    : ERROR_CATALOG

  return (
    <div className="space-y-4">
      <input
        type="search"
        placeholder="Search by code, message, or cause…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search error codes"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {ERROR_CATALOG.length} error codes
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching error codes.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium w-44">Code</th>
                <th className="px-4 py-3 text-left font-medium">Description</th>
                <th className="px-4 py-3 text-left font-medium">Common causes</th>
                <th className="px-4 py-3 text-left font-medium">Resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((entry) => (
                <tr key={entry.code} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {entry.code}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{entry.message}</td>
                  <td className="px-4 py-3">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {entry.causes.map((cause, i) => (
                        <li key={i}>{cause}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3">{entry.resolution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
