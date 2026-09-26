'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * Transaction history list for /transactions.
 *
 * Renders the user's on-chain activity with the insurance contract
 * (purchases, claims, votes, payouts, renewals) with human-readable
 * labels, amounts, status and explorer links.
 *
 * - Paginated list with a type filter and date grouping.
 * - Contract operations mapped to friendly labels and icons.
 * - Locally-tracked pending transactions shown at the top until they confirm.
 * - Every row links to the relevant policy or claim when applicable.
 */

export type TransactionType =
  | 'purchase'
  | 'claim'
  | 'vote'
  | 'payout'
  | 'renewal';

export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  /** Amount in the contract's base unit (e.g. stroops). */
  amount: string;
  /** ISO-8601 timestamp of when the transaction was submitted. */
  timestamp: string;
  /** Optional policy this transaction relates to. */
  policyId?: string;
  /** Optional claim this transaction relates to. */
  claimId?: string;
  /** Optional explorer URL for the transaction. */
  explorerUrl?: string;
}

interface TransactionListProps {
  transactions: Transaction[];
  /** Locally-tracked transactions that have not confirmed yet. */
  pendingTransactions?: Transaction[];
  pageSize?: number;
}

interface OperationMeta {
  label: string;
  icon: string;
}

const OPERATION_META: Record<TransactionType, OperationMeta> = {
  purchase: { label: 'Policy Purchase', icon: '🛡️' },
  claim: { label: 'Claim Filed', icon: '📝' },
  vote: { label: 'Governance Vote', icon: '🗳️' },
  payout: { label: 'Claim Payout', icon: '💰' },
  renewal: { label: 'Policy Renewal', icon: '🔄' },
};

const STATUS_META: Record<TransactionStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: 'Confirmed', className: 'bg-green-100 text-green-800' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800' },
};

const FILTERS: Array<{ value: TransactionType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'purchase', label: 'Purchases' },
  { value: 'claim', label: 'Claims' },
  { value: 'vote', label: 'Votes' },
  { value: 'payout', label: 'Payouts' },
  { value: 'renewal', label: 'Renewals' },
];

/** Maps a contract operation to its friendly label and icon. */
export function getOperationMeta(type: TransactionType): OperationMeta {
  return OPERATION_META[type];
}

/** Merges locally-tracked pending transactions ahead of confirmed history. */
export function mergePendingTransactions(
  transactions: Transaction[],
  pendingTransactions: Transaction[] = [],
): Transaction[] {
  const pendingIds = new Set(pendingTransactions.map((tx) => tx.id));
  const confirmed = transactions.filter((tx) => !pendingIds.has(tx.id));
  return [...pendingTransactions, ...confirmed];
}

/** Groups transactions by calendar day, preserving input order. */
export function groupByDate(transactions: Transaction[]): Array<[string, Transaction[]]> {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const day = tx.timestamp.slice(0, 10);
    const bucket = groups.get(day);
    if (bucket) {
      bucket.push(tx);
    } else {
      groups.set(day, [tx]);
    }
  }
  return Array.from(groups.entries());
}

function formatAmount(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return amount;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 7 });
}

function formatDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return day;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const meta = getOperationMeta(transaction.type);
  const status = STATUS_META[transaction.status];

  return (
    <li className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-xl">
          {meta.icon}
        </span>
        <div className="flex flex-col">
          <span className="font-medium text-gray-900">{meta.label}</span>
          <span className="text-sm text-gray-500">
            {new Date(transaction.timestamp).toLocaleString()}
          </span>
          <div className="mt-1 flex gap-3 text-sm">
            {transaction.policyId && (
              <Link
                href={`/policies/${transaction.policyId}`}
                className="text-blue-600 hover:underline"
              >
                Policy #{transaction.policyId}
              </Link>
            )}
            {transaction.claimId && (
              <Link
                href={`/claims/${transaction.claimId}`}
                className="text-blue-600 hover:underline"
              >
                Claim #{transaction.claimId}
              </Link>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono text-sm text-gray-900">{formatAmount(transaction.amount)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
          {status.label}
        </span>
        {transaction.explorerUrl && (
          <a
            href={transaction.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            Explorer
          </a>
        )}
      </div>
    </li>
  );
}

export default function TransactionList({
  transactions,
  pendingTransactions = [],
  pageSize = 10,
}: TransactionListProps) {
  const [filter, setFilter] = useState<TransactionType | 'all'>('all');
  const [page, setPage] = useState(1);

  const merged = useMemo(
    () => mergePendingTransactions(transactions, pendingTransactions),
    [transactions, pendingTransactions],
  );

  const filtered = useMemo(
    () => (filter === 'all' ? merged : merged.filter((tx) => tx.type === filter)),
    [merged, filter],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const groups = groupByDate(pageItems);

  const handleFilterChange = (value: TransactionType | 'all') => {
    setFilter(value);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleFilterChange(option.value)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              filter === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-gray-500">No transactions found.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([day, items]) => (
            <section key={day}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {formatDate(day)}
              </h3>
              <ul className="rounded-lg border border-gray-200 bg-white px-4">
                {items.map((tx) => (
                  <TransactionRow key={tx.id} transaction={tx} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
