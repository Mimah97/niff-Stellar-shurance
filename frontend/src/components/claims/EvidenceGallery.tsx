'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { X, ChevronLeft, ChevronRight, Download, FileText, ZoomIn, ZoomOut, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { getConfig } from '@/config/env'

const { apiUrl: API_BASE } = getConfig()

interface EvidenceItem {
  index: number
  contentType: string
  url: string
  /** Raw blob bytes for client-side hash verification */
  blob: Blob
}

function evidenceUrl(claimId: number, index: number) {
  return `${API_BASE}/api/claims/${claimId}/evidence/${index}`
}

function isPdf(contentType: string) {
  return contentType === 'application/pdf'
}

/** Compute SHA-256 of a Blob using the Web Crypto API. Returns lowercase hex. */
async function computeBlobSha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function useEvidence(claimId: number, index: number) {
  return useQuery<EvidenceItem>({
    queryKey: ['evidence', claimId, index],
    queryFn: async () => {
      const res = await fetch(evidenceUrl(claimId, index), { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to fetch evidence ${index}`)
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
      const blob = await res.blob()
      return { index, contentType, url: URL.createObjectURL(blob), blob }
    },
  })
}

type VerifyState = 'idle' | 'verifying' | 'match' | 'mismatch'

/** Verify button: computes SHA-256 of fetched blob and compares against expected hash. */
function VerifyHashButton({
  blob,
  expectedHash,
}: {
  blob: Blob
  expectedHash: string
}) {
  const [state, setState] = useState<VerifyState>('idle')

  async function handleVerify() {
    setState('verifying')
    try {
      const computed = await computeBlobSha256(blob)
      setState(computed.toLowerCase() === expectedHash.toLowerCase() ? 'match' : 'mismatch')
    } catch {
      setState('mismatch')
    }
  }

  if (state === 'match') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium" role="status">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
        Verified
      </span>
    )
  }
  if (state === 'mismatch') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 font-medium" role="alert">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        Hash mismatch
      </span>
    )
  }

  return (
    <button
      onClick={handleVerify}
      disabled={state === 'verifying'}
      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline disabled:opacity-60"
      aria-label="Verify file integrity against on-chain SHA-256 commitment"
    >
      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
      {state === 'verifying' ? 'Verifying…' : 'Verify'}
    </button>
  )
}

function Thumbnail({
  claimId,
  index,
  commitmentHash,
  onClick,
}: {
  claimId: number
  index: number
  commitmentHash?: string
  onClick: () => void
}) {
  const { data, isLoading } = useEvidence(claimId, index)

  if (isLoading) {
    return <div className="w-24 h-24 rounded bg-muted animate-pulse" />
  }
  if (!data) return null

  const shortHash = commitmentHash
    ? `${commitmentHash.slice(0, 8)}…${commitmentHash.slice(-6)}`
    : null

  return (
    <div className="flex flex-col gap-1.5">
      {isPdf(data.contentType) ? (
        <button
          onClick={onClick}
          className="w-24 h-24 rounded border flex flex-col items-center justify-center gap-1 hover:bg-muted transition-colors"
          aria-label={`PDF evidence ${index + 1}`}
        >
          <FileText className="w-8 h-8 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">PDF</span>
        </button>
      ) : (
        <button
          onClick={onClick}
          className="relative w-24 h-24 rounded border overflow-hidden hover:opacity-80 transition-opacity"
          aria-label={`Image evidence ${index + 1}`}
        >
          <Image src={data.url} alt={`Evidence ${index + 1}`} fill className="object-cover" />
          <ZoomIn className="absolute bottom-1 right-1 w-4 h-4 text-white drop-shadow" />
        </button>
      )}

      {commitmentHash && (
        <div className="w-24 space-y-1">
          <p
            className="font-mono text-[10px] text-muted-foreground truncate"
            title={`SHA-256: ${commitmentHash}`}
            aria-label={`SHA-256 commitment: ${commitmentHash}`}
          >
            {shortHash}
          </p>
          <VerifyHashButton blob={data.blob} expectedHash={commitmentHash} />
        </div>
      )}
    </div>
  )
}

function Lightbox({
  claimId,
  indices,
  activeIndex,
  onClose,
  onNav,
}: {
  claimId: number
  indices: number[]
  activeIndex: number
  onClose: () => void
  onNav: (i: number) => void
}) {
  const [zoom, setZoom] = useState(1)
  const { data } = useEvidence(claimId, indices[activeIndex])

  const canPrev = activeIndex > 0
  const canNext = activeIndex < indices.length - 1

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/95">
        <div className="relative flex flex-col h-[80vh]">
          {/* toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-black/60 text-white">
            <span className="text-sm">
              {activeIndex + 1} / {indices.length}
            </span>
            <div className="flex gap-2">
              {data && !isPdf(data.contentType) && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white"
                    onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white"
                    onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                </>
              )}
              {data && (
                <a
                  href={data.url}
                  download={`evidence-${activeIndex + 1}${isPdf(data.contentType) ? '.pdf' : ''}`}
                  aria-label="Download"
                >
                  <Button variant="ghost" size="icon" className="text-white">
                    <Download className="w-4 h-4" />
                  </Button>
                </a>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-white"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* content */}
          <div className="flex-1 flex items-center justify-center overflow-auto p-4">
            {data && isPdf(data.contentType) ? (
              <div className="flex flex-col items-center gap-4 text-white">
                <FileText className="w-16 h-16" />
                <p className="text-sm">PDF evidence {activeIndex + 1}</p>
                <a href={data.url} download={`evidence-${activeIndex + 1}.pdf`}>
                  <Button variant="secondary">
                    <Download className="w-4 h-4 mr-2" /> Download PDF
                  </Button>
                </a>
              </div>
            ) : data ? (
              <div
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.2s' }}
              >
                <img
                  src={data.url}
                  alt={`Evidence ${activeIndex + 1}`}
                  className="max-h-[60vh] max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="w-32 h-32 rounded bg-muted animate-pulse" />
            )}
          </div>

          {/* nav arrows */}
          {canPrev && (
            <button
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1 text-white hover:bg-black/70"
              onClick={() => { setZoom(1); onNav(activeIndex - 1) }}
              aria-label="Previous"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {canNext && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1 text-white hover:bg-black/70"
              onClick={() => { setZoom(1); onNav(activeIndex + 1) }}
              aria-label="Next"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export interface EvidenceGalleryProps {
  claimId: number
  /** Total number of evidence items on the claim */
  count: number
  /**
   * On-chain SHA-256 commitment hashes, one per evidence item in order.
   * When provided, each thumbnail shows the truncated hash and a client-side
   * integrity verify button.
   */
  hashes?: string[]
}

export function EvidenceGallery({ claimId, count, hashes }: EvidenceGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const indices = Array.from({ length: count }, (_, i) => i)

  if (count === 0) return null

  return (
    <div>
      <div className="flex flex-wrap gap-4" role="list" aria-label="Evidence gallery">
        {indices.map((i) => (
          <div key={i} role="listitem">
            <Thumbnail
              claimId={claimId}
              index={i}
              commitmentHash={hashes?.[i]}
              onClick={() => setLightboxIndex(i)}
            />
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          claimId={claimId}
          indices={indices}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNav={setLightboxIndex}
        />
      )}
    </div>
  )
}
