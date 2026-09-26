import React from 'react';

/**
 * AppealConfirmModal
 *
 * Confirmation dialog shown to a claimant before submitting an appeal.
 * Explains the elevated quorum, the one-appeal limit and the appeal timeline.
 *
 * The modal is intentionally presentational: the parent owns the appeal
 * submission state (idle / submitting / error) and passes it down so the
 * confirm action can reflect progress and failures.
 */
export interface AppealConfirmModalProps {
  /** Whether the modal is currently visible. */
  open: boolean;
  /** Called when the claimant confirms the appeal. */
  onConfirm: () => void;
  /** Called when the claimant dismisses the modal. */
  onCancel: () => void;
  /** Submission state owned by the parent. */
  status?: 'idle' | 'submitting' | 'error';
  /** Optional error message shown when status is 'error'. */
  errorMessage?: string;
  /** Elevated quorum required for the appeal round, as a percentage. */
  appealQuorumPercent?: number;
  /** Standard quorum for the original round, as a percentage. */
  standardQuorumPercent?: number;
  /** Length of the appeal voting window, in days. */
  appealWindowDays?: number;
}

const DEFAULT_STANDARD_QUORUM = 51;
const DEFAULT_APPEAL_QUORUM = 67;
const DEFAULT_APPEAL_WINDOW_DAYS = 7;

export const AppealConfirmModal: React.FC<AppealConfirmModalProps> = ({
  open,
  onConfirm,
  onCancel,
  status = 'idle',
  errorMessage,
  appealQuorumPercent = DEFAULT_APPEAL_QUORUM,
  standardQuorumPercent = DEFAULT_STANDARD_QUORUM,
  appealWindowDays = DEFAULT_APPEAL_WINDOW_DAYS,
}) => {
  if (!open) {
    return null;
  }

  const isSubmitting = status === 'submitting';
  const isError = status === 'error';

  return (
    <div
      className="appeal-confirm-modal__backdrop"
      role="presentation"
      onClick={isSubmitting ? undefined : onCancel}
    >
      <div
        className="appeal-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appeal-confirm-modal-title"
        aria-describedby="appeal-confirm-modal-description"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="appeal-confirm-modal-title" className="appeal-confirm-modal__title">
          Appeal this decision
        </h2>

        <p id="appeal-confirm-modal-description" className="appeal-confirm-modal__description">
          You are about to appeal the rejection of your claim. Appeal voters will
          review the claim in a fresh round.
        </p>

        <ul className="appeal-confirm-modal__details">
          <li className="appeal-confirm-modal__detail">
            <strong>Elevated quorum.</strong> The appeal round requires a higher
            quorum of {appealQuorumPercent}% (up from {standardQuorumPercent}% in
            the original round).
          </li>
          <li className="appeal-confirm-modal__detail">
            <strong>One appeal only.</strong> Each claim may be appealed a single
            time. Once submitted, this decision cannot be appealed again.
          </li>
          <li className="appeal-confirm-modal__detail">
            <strong>Timeline.</strong> Appeal voting stays open for{' '}
            {appealWindowDays} day{appealWindowDays === 1 ? '' : 's'}. If the
            elevated quorum is not reached within that window, the original
            rejection stands.
          </li>
        </ul>

        {isError && (
          <p className="appeal-confirm-modal__error" role="alert">
            {errorMessage || 'Something went wrong submitting your appeal. Please try again.'}
          </p>
        )}

        <div className="appeal-confirm-modal__actions">
          <button
            type="button"
            className="appeal-confirm-modal__cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="appeal-confirm-modal__confirm"
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting appeal…' : 'Submit appeal'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppealConfirmModal;
