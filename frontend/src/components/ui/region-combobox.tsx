'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Search } from 'lucide-react'
import { getConfig } from '@/config/env'

export interface Region {
  id: string
  label: string
  factor: number
  description: string
}

interface RegionComboboxProps {
  value?: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}

export function RegionCombobox({ value, onChange, error, disabled }: RegionComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apiUrl = getConfig().apiUrl
    fetch(`${apiUrl}/policy/regions`)
      .then((r) => r.json())
      .then((data: Region[]) => setRegions(data))
      .catch(() => setRegions([
        { id: 'Low', label: 'Low Risk', factor: 8, description: 'Low-risk regions with stable conditions.' },
        { id: 'Medium', label: 'Medium Risk', factor: 10, description: 'Moderate-risk regions with some variability.' },
        { id: 'High', label: 'High Risk', factor: 14, description: 'High-risk regions with elevated claim probability.' },
      ]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = regions.filter(
    (r) =>
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.label.toLowerCase().includes(search.toLowerCase()),
  )

  const selected = regions.find((r) => r.id === value)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setOpen(!open)}
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${error ? 'border-destructive' : 'border-input'}`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={selected ? '' : 'text-muted-foreground'}>
            {loading ? 'Loading regions…' : selected ? selected.label : 'Select a region…'}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg">
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <input
              className="h-10 w-full border-0 bg-transparent px-2 text-sm outline-none focus:ring-0"
              placeholder="Search regions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="max-h-60 overflow-auto py-1" role="listbox" aria-label="Regions">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No regions found.</li>
            ) : (
              filtered.map((region) => (
                <li
                  key={region.id}
                  role="option"
                  aria-selected={region.id === value}
                  className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-muted ${
                    region.id === value ? 'bg-muted font-medium' : ''
                  }`}
                  onClick={() => {
                    onChange(region.id)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <div className="flex flex-col">
                    <span>{region.label}</span>
                    <span className="text-xs text-muted-foreground">{region.description}</span>
                  </div>
                  {region.id === value && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive flex items-center gap-1 mt-1" role="alert">
          <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}
