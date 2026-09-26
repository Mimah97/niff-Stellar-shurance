import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpRight,
  FileText,
  RefreshCw,
  ShieldCheck,
  Vote,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTransactions } from "@/hooks/useTransactions";
import { usePendingTransactions } from "@/hooks/usePendingTransactions";
import { cn } from "@/lib/utils";
import type { Transaction, TransactionType } from "@/types/transaction";

type OperationMeta = {
  label: string;
  icon: typeof ShieldCheck;
  tone: string;
};

const OPERATION_META: Record<TransactionType, OperationMeta> = {
  purchase: {
    label: "Policy purchased",
    icon: ShieldCheck,
    tone: "text-emerald-600",
  },
  claim: {
    label: "Claim submitted",
    icon: FileText,
    tone: "text-amber-600",
  },
  vote: {
    label: "Vote cast",
    icon: Vote,
    tone: "text-indigo-600",
  },
  payout: {
    label: "Payout received",
    icon: ArrowDownToLine,
    tone: "text-emerald-600",
  },
  renewal: {
    label: "Policy renewed",
    icon: RefreshCw,
    tone: "text-sky-600",
  },
};

const FILTER_OPTIONS: { value: TransactionType | "all"; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "purchase", label: "Purchases" },
  { value: "claim", label: "Claims" },
  { value: "vote", label: "Votes" },
  { value: "payout", label: "Payouts" },
  { value: "renewal", label: "Renewals" },
];

const PAGE_SIZE = 10;

function formatAmount(amount: string, asset: string) {
  const value = Number(amount);
  if (Number.isNaN(value)) return `${amount} ${asset}`;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })} ${asset}`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function groupByDate(transactions: Transaction[]) {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const key = formatDate(tx.timestamp);
    const bucket = groups.get(key);
    if (bucket) bucket.push(tx);
    else groups.set(key, [tx]);
  }
  return Array.from(groups.entries());
}

function statusVariant(status: Transaction["status"]) {
  switch (status) {
    case "confirmed":
      return "success" as const;
    case "failed":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function TransactionRow({ tx }: { tx: Transaction }) {
  const meta = OPERATION_META[tx.type];
  const Icon = meta.icon;
  const href = tx.claimId
    ? `/claims/${tx.claimId}`
    : tx.policyId
      ? `/policies/${tx.policyId}`
      : undefined;

  const body = (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full bg-muted",
            meta.tone,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{meta.label}</span>
          <span className="text-xs text-muted-foreground">
            {formatAmount(tx.amount, tx.asset)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={statusVariant(tx.status)}>{tx.status}</Badge>
        {tx.hash ? (
          <a
            href={`https://stellar.expert/explorer/public/tx/${tx.hash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            Explorer
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );

  if (!href) return body;

  return (
    <Link href={href} className="block rounded-md hover:bg-muted/50">
      {body}
    </Link>
  );
}

export default function TransactionsPage() {
  const [filter, setFilter] = useState<TransactionType | "all">("all");
  const [page, setPage] = useState(1);
  const { transactions, isLoading } = useTransactions();
  const { pending } = usePendingTransactions();

  const filtered = useMemo(() => {
    if (filter === "all") return transactions;
    return transactions.filter((tx) => tx.type === filter);
  }, [transactions, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const groups = groupByDate(paginated);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Transaction history</h1>
        <Select
          value={filter}
          onValueChange={(value) => {
            setFilter(value as TransactionType | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter activity" />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {pending.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="divide-y">
          {isLoading ? (
            <div className="flex flex-col gap-3 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transactions found.
            </p>
          ) : (
            groups.map(([date, items]) => (
              <div key={date} className="py-2">
                <p className="py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {date}
                </p>
                <div className="divide-y">
                  {items.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
