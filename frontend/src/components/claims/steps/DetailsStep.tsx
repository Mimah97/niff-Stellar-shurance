'use client';

import { Label } from '@/components/ui';
import { NumericInput } from '@/components/ui';
import { formatTokenAmount } from '@/lib/formatTokenAmount';

interface DetailsStepProps {
  amount: string;
  details: string;
  onAmountChange: (amount: string) => void;
  onDetailsChange: (details: string) => void;
  maxCoverage: string;
  decimals?: number;
  currency?: string;
  locale?: string;
}

export function DetailsStep({
  amount,
  details,
  onAmountChange,
  onDetailsChange,
  maxCoverage,
  decimals = 7,
  currency = 'XLM',
  locale = 'en-US',
}: DetailsStepProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label htmlFor="amount">Claim Amount ({currency})</Label>
        <NumericInput
          id="amount"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder={`Enter claim amount (e.g. 10000000 for 1 ${currency})`}
          min="1"
          max={maxCoverage}
        />
        <p className="text-sm text-muted-foreground">
          Maximum coverage: {formatTokenAmount(maxCoverage || '0', decimals, locale)} {currency}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="details">Claim Narrative</Label>
        <textarea
          id="details"
          value={details}
          onChange={(e) => onDetailsChange(e.target.value)}
          placeholder="Describe what happened and why you are filing this claim..."
          className="min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          maxLength={1000}
        />
        <p className="text-right text-xs text-muted-foreground">{details.length}/1000</p>
      </div>

      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/30 dark:bg-yellow-900/20">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          <strong>Privacy Warning:</strong> Do not include sensitive personal information (SSN,
          medical records, etc.) in the narrative. Focus on the event details.
        </p>
      </div>
    </div>
  );
}
