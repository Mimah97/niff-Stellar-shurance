import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useAppealVote } from '../../hooks/useAppealVote';
import { useAppealWindow } from '../../hooks/useAppealWindow';
import { formatCountdown } from '../../utils/formatCountdown';
import { explorerTxUrl } from '../../utils/explorer';
import { VotePanel } from './VotePanel';
import { AppealConfirmModal } from './AppealConfirmModal';
import { TransactionSuccess } from './TransactionSuccess';

interface AppealVotePanelProps {
  claimId: string;
  claimant: string;
  appealDeadline: number;
  quorum: number;
  onVoted?: (txHash: string) => void;
}

/**
 * Appeal voting panel. Reuses the standard VotePanel patterns for the
 * approve/reject controls and adds the claimant-only appeal entry point.
 */
export function AppealVotePanel({
  claimId,
  claimant,
  appealDeadline,
  quorum,
  onVoted,
}: AppealVotePanelProps) {
  const { address } = useAccount();
  const { remaining, isOpen } = useAppealWindow(appealDeadline);
  const { submitAppeal, isSubmitting, error, txHash } = useAppealVote(claimId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isClaimant = !!address && address.toLowerCase() === claimant.toLowerCase();

  // Hide the appeal button entirely for non-claimants.
  if (!isClaimant) {
    return (
      <VotePanel
        claimId={claimId}
        quorum={quorum}
        onVoted={onVoted}
      />
    );
  }

  if (txHash) {
    return (
      <TransactionSuccess
        title="Appeal submitted"
        description="Your appeal has been recorded. Appeal voters will now vote in a fresh round."
        txHash={txHash}
        explorerUrl={explorerTxUrl(txHash)}
      />
    );
  }

  return (
    <div className="appeal-vote-panel">
      <VotePanel
        claimId={claimId}
        quorum={quorum}
        onVoted={onVoted}
      />

      {isOpen && (
        <div className="appeal-vote-panel__appeal">
          <button
            type="button"
            className="appeal-button"
            disabled={isSubmitting}
            onClick={() => setConfirmOpen(true)}
          >
            {isSubmitting ? 'Submitting appeal…' : 'Appeal rejection'}
          </button>
          <span className="appeal-button__countdown">
            Appeal window closes in {formatCountdown(remaining)}
          </span>
          {error && (
            <p className="appeal-button__error" role="alert">
              {error.message ?? 'Failed to submit appeal.'}
            </p>
          )}
        </div>
      )}

      <AppealConfirmModal
        open={confirmOpen}
        quorum={quorum}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          await submitAppeal();
        }}
      />
    </div>
  );
}
