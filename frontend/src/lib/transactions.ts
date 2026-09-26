export type TransactionType =
  | "purchase"
  | "claim"
  | "vote"
  | "payout"
  | "renewal";

export type TransactionStatus = "pending" | "confirmed" | "failed";

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  timestamp: number;
  policyId?: string;
  claimId?: string;
  txHash?: string;
}

export interface TransactionLabel {
  label: string;
  icon: string;
}

const LABELS: Record<TransactionType, TransactionLabel> = {
  purchase: { label: "Policy Purchase", icon: "shield" },
  claim: { label: "Claim Filed", icon: "file-text" },
  vote: { label: "Governance Vote", icon: "vote" },
  payout: { label: "Claim Payout", icon: "coins" },
  renewal: { label: "Policy Renewal", icon: "refresh" },
};

export function getTransactionLabel(type: TransactionType): TransactionLabel {
  return LABELS[type] ?? { label: type, icon: "activity" };
}

export function getExplorerUrl(txHash: string, baseUrl = "https://stellar.expert/explorer/public/tx"): string {
  return `${baseUrl}/${txHash}`;
}

export function mergePendingTransactions(
  confirmed: Transaction[],
  pending: Transaction[]
): Transaction[] {
  const pendingIds = new Set(pending.map((tx) => tx.id));
  const deduped = confirmed.filter((tx) => !pendingIds.has(tx.id));
  return [...pending, ...deduped];
}

export function groupByDate(transactions: Transaction[]): { date: string; items: Transaction[] }[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const date = new Date(tx.timestamp).toISOString().slice(0, 10);
    const bucket = groups.get(date);
    if (bucket) {
      bucket.push(tx);
    } else {
      groups.set(date, [tx]);
    }
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items }));
}

export function filterByType(
  transactions: Transaction[],
  type: TransactionType | "all"
): Transaction[] {
  if (type === "all") return transactions;
  return transactions.filter((tx) => tx.type === type);
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return items.slice(start, start + pageSize);
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
