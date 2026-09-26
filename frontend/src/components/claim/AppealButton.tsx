import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAppeal } from '../../hooks/useAppeal';
import { AppealConfirmModal } from './AppealConfirmModal';
import { AppealSuccessState } from './AppealSuccessState';

interface AppealButtonProps {
  claimId: string;
  claimant: string;
  appealDeadline: number;
  onAppealSubmitted?: (txHash: string) => void;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function AppealButton({
  claimId,
  claimant,
  appealDeadline,
  onAppealSubmitted,
}: AppealButtonProps) {
  const { address } = useAccount();
  const { submitAppeal, isSubmitting, error, txHash } = useAppeal(claimId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isClaimant = useMemo(
    () => Boolean(address) && address?.toLowerCase() === claimant.toLowerCase(),
    [address, claimant],
  );

  const deadlineMs = appealDeadline * 1000;
  const remainingMs = deadlineMs - now;
  const isWindowOpen = remainingMs > 0;

  useEffect(() => {
    if (!isClaimant || !isWindowOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isClaimant, isWindowOpen]);

  useEffect(() => {
    if (txHash && onAppealSubmitted) {
      onAppealSubmitted(txHash);
    }
  }, [txHash, onAppealSubmitted]);

  // Hide entirely for non-claimants.
  if (!isClaimant) return null;

  if (txHash) {
    return <AppealSuccessState txHash={txHash} />;
  }

  if (!isWindowOpen) {
    return (
      <div className="appeal-button appeal-button--expired" role="status">
        <span className="appeal-button__label">Appeal window closed</span>
      </div>
    );
  }

  return (
    <div className="appeal-button">
      <button
        type="button"
        className="appeal-button__trigger"
        onClick={() => setIsModalOpen(true)}
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Submitting appeal…' : 'Appeal decision'}
      </button>
      <span className="appeal-button__countdown" aria-live="polite">
        Appeal window closes in {formatRemaining(remainingMs)}
      </span>
      {error ? (
        <p className="appeal-button__error" role="alert">
          {error.message ?? 'Failed to submit appeal. Please try again.'}
        </p>
      ) : null}
      <AppealConfirmModal
        isOpen={isModalOpen}
        isSubmitting={isSubmitting}
        error={error}
        onClose={() => setIsModalOpen(false)}
        onConfirm={async () => {
          await submitAppeal();
          setIsModalOpen(false);
        }}
      />
    </div>
  );
}

export default AppealButton;
