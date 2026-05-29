'use client';

import { X, Upload, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import React, { useState, useCallback, useRef } from 'react';

import { Button, Progress, Label } from '@/components/ui';
import {
  computeFileSha256Hex,
  uploadFileWithProgress,
  UploadProgress,
} from '@/lib/ipfs-upload';

interface FileUploadState {
  file: File;
  progress: number;
  status: 'pending' | 'hashing' | 'uploading' | 'completed' | 'error';
  cid?: string;
  url?: string;
  hash?: string;
  error?: string;
  controller?: AbortController;
}

export type EvidenceAttachment = { cid: string; url: string; contentSha256Hex: string };

interface EvidenceStepProps {
  evidence: EvidenceAttachment[];
  onChange: (items: EvidenceAttachment[]) => void;
  minEvidence?: number;
  maxEvidence?: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function EvidenceStep({ evidence, onChange, minEvidence = 1, maxEvidence = 5 }: EvidenceStepProps) {
  const [uploads, setUploads] = useState<Record<string, FileUploadState>>({});
  const uploadsRef = useRef<Record<string, FileUploadState>>({});
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;

  const [consent, setConsent] = useState(false);

  const completedCount = evidence.length;
  const belowMin = completedCount < minEvidence;
  const atMax = completedCount >= maxEvidence;

  const updateUpload = useCallback((id: string, patch: Partial<FileUploadState>) => {
    setUploads(prev => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      uploadsRef.current = next;
      return next;
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    setUploads(prev => {
      const next = { ...prev };
      files.forEach((file) => {
        if (file.size > MAX_FILE_SIZE || !ALLOWED_TYPES.includes(file.type)) return;
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        next[id] = { file, progress: 0, status: 'pending' };
      });
      uploadsRef.current = next;
      return next;
    });
  }, []);

  const startUpload = useCallback(async (id: string) => {
    const upload = uploadsRef.current[id];
    if (!upload || upload.status === 'uploading' || upload.status === 'hashing') return;

    const controller = new AbortController();
    updateUpload(id, { status: 'hashing', progress: 0, controller, error: undefined });

    try {
      const contentSha256Hex = await computeFileSha256Hex(upload.file);
      updateUpload(id, { hash: contentSha256Hex, status: 'uploading' });

      const response = await uploadFileWithProgress(
        upload.file,
        (p: UploadProgress) => updateUpload(id, { progress: p.percentage }),
        controller.signal,
        3,
        contentSha256Hex,
      );

      const cid = response.cid;
      const url = response.gatewayUrls[0] || '';
      updateUpload(id, { status: 'completed', progress: 100, cid, url });

      const current = evidenceRef.current;
      onChange([...current.filter(e => e.cid !== cid), { cid, url, contentSha256Hex }]);
    } catch (err) {
      if (err instanceof Error && err.message === 'Upload aborted') return;
      updateUpload(id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [updateUpload, onChange]);

  const cancelUpload = useCallback((id: string) => {
    const upload = uploadsRef.current[id];
    if (!upload) return;
    upload.controller?.abort();
    if (upload.cid) {
      onChange(evidenceRef.current.filter(e => e.cid !== upload.cid));
    }
    setUploads(prev => {
      const next = { ...prev };
      delete next[id];
      uploadsRef.current = next;
      return next;
    });
  }, [onChange]);

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center">
          <Upload className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">Evidence Collection</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload photos or documents as evidence. Max 5MB per file.
            {minEvidence > 0 && (
              <span className="block mt-1">
                Required: {minEvidence}–{maxEvidence} files.
              </span>
            )}
          </p>
          <div className="mt-6">
            <input
              type="file"
              id="file-upload"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
              disabled={atMax}
            />
            <Button asChild variant="outline" disabled={atMax}>
              <label
                htmlFor="file-upload"
                className={atMax ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              >
                Select Files
              </label>
            </Button>
          </div>
        </div>

        {/* Validation messages */}
        {belowMin && completedCount === 0 && (
          <p role="alert" className="text-sm text-destructive">
            At least {minEvidence} file{minEvidence !== 1 ? 's' : ''} required before proceeding.
          </p>
        )}
        {belowMin && completedCount > 0 && (
          <p role="alert" className="text-sm text-destructive">
            At least {minEvidence} file{minEvidence !== 1 ? 's' : ''} required. {completedCount} uploaded so far.
          </p>
        )}
        {atMax && (
          <p className="text-sm text-muted-foreground">
            Maximum of {maxEvidence} files reached.
          </p>
        )}

        {/* Upload List */}
        <div className="space-y-3">
          {Object.entries(uploads).map(([id, upload]) => (
            <div key={id} className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{upload.file.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {upload.status === 'pending' && (
                    <Button size="sm" onClick={() => startUpload(id)}>Upload</Button>
                  )}
                  {upload.status === 'error' && (
                    <>
                      <span className="text-xs text-destructive">{upload.error}</span>
                      <Button size="sm" variant="outline" onClick={() => startUpload(id)}>
                        Retry
                      </Button>
                    </>
                  )}
                  {upload.status === 'completed' && (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => cancelUpload(id)}
                    aria-label={`Remove ${upload.file.name}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {upload.status === 'uploading' && (
                <div className="space-y-1">
                  <Progress value={upload.progress} className="h-1.5" />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Uploading...</span>
                    <span>{upload.progress}%</span>
                  </div>
                </div>
              )}
              {upload.status === 'hashing' && (
                <p className="text-[10px] text-muted-foreground">Computing SHA-256 hash...</p>
              )}

              {/* CID preview — shown immediately after upload completes */}
              {upload.status === 'completed' && upload.cid && (
                <div className="rounded-md bg-muted/50 p-2 space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    IPFS CID
                  </p>
                  <p
                    className="text-[11px] font-mono break-all text-foreground"
                    data-testid="cid-preview"
                  >
                    {upload.cid}
                  </p>
                  {upload.url && (
                    <a
                      href={upload.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary hover:underline"
                    >
                      View on gateway ↗
                    </a>
                  )}
                </div>
              )}

              {upload.hash && (
                <div className="text-[10px] text-muted-foreground font-mono break-all">
                  SHA-256: {upload.hash}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-lg border bg-yellow-50 p-4 dark:bg-yellow-900/10">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-yellow-900 dark:text-yellow-200">
              Legal &amp; Privacy Reminder
            </h4>
            <ul className="list-disc pl-4 text-xs text-yellow-800 space-y-1 dark:text-yellow-300">
              <li>Evidence uploaded via IPFS is permanently immutable. It cannot be deleted.</li>
              <li>Please redact any PII not relevant to the claim.</li>
              <li>Ensure you have the right to share these images.</li>
            </ul>
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="consent"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="consent" className="text-xs font-medium cursor-pointer">
                I understand that this evidence will be stored permanently on IPFS.
              </Label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
