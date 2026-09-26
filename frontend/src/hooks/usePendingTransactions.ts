"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Locally-tracked pending transactions.
 *
 * The insurance contract does not expose a mempool, so transactions that the
 * user just submitted are tracked in the browser (localStorage) until they are
 * confirmed on-chain. The transaction history page merges these pending
 * entries at the top of the list.
 */

export type PendingTransactionType =
  | "purchase"
  | "claim"
  | "vote"
  | "payout"
  | "renewal";

export interface PendingTransaction {
  /** Transaction hash returned by the wallet / contract call. */
  hash: string;
  type: PendingTransactionType;
  /** Human-readable amount, e.g. "120.00 XLM". */
  amount?: string;
  /** Policy id this transaction relates to, when applicable. */
  policyId?: string;
  /** Claim id this transaction relates to, when applicable. */
  claimId?: string;
  /** ISO timestamp of when the transaction was submitted. */
  submittedAt: string;
}

const STORAGE_KEY = "handsoff:pending-transactions";

function readStorage(): PendingTransaction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingTransaction =>
        !!entry && typeof entry.hash === "string" && typeof entry.type === "string",
    );
  } catch {
    return [];
  }
}

function writeStorage(entries: PendingTransaction[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage may be unavailable (private mode); pending tracking is best-effort.
  }
}

/**
 * Track transactions submitted by the current user until they confirm.
 *
 * Returns the current pending list plus helpers to add, remove and clear
 * entries. Entries are persisted so a page reload does not lose them.
 */
export function usePendingTransactions() {
  const [pending, setPending] = useState<PendingTransaction[]>([]);

  useEffect(() => {
    setPending(readStorage());
  }, []);

  const addPending = useCallback((transaction: PendingTransaction) => {
    setPending((current) => {
      const next = [transaction, ...current.filter((t) => t.hash !== transaction.hash)];
      writeStorage(next);
      return next;
    });
  }, []);

  const removePending = useCallback((hash: string) => {
    setPending((current) => {
      const next = current.filter((t) => t.hash !== hash);
      writeStorage(next);
      return next;
    });
  }, []);

  const clearPending = useCallback(() => {
    setPending([]);
    writeStorage([]);
  }, []);

  return { pending, addPending, removePending, clearPending };
}

export default usePendingTransactions;
