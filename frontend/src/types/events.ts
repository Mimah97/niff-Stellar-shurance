/**
 * Typed definitions for the backend Server-Sent Events stream.
 *
 * The backend exposes a single event stream (see issue #1525) that emits
 * claim tally updates, claim status changes and transaction confirmations.
 * These types are shared by the `useEventStream()` provider and the typed
 * event handlers that patch the React Query cache.
 */

export type ClaimTallyEvent = {
  type: 'claim.tally';
  claimId: string;
  /** Total number of votes cast so far. */
  votes: number;
  /** Votes in favour of the claim. */
  forVotes: number;
  /** Votes against the claim. */
  againstVotes: number;
};

export type ClaimStatusEvent = {
  type: 'claim.status';
  claimId: string;
  status: ClaimStatus;
};

export type TransactionConfirmationEvent = {
  type: 'transaction.confirmation';
  /** Client-side transaction hash used to correlate the confirmation. */
  txHash: string;
  status: TransactionStatus;
  /** Optional block number once the transaction is mined. */
  blockNumber?: number;
};

export type ClaimStatus =
  | 'open'
  | 'appealed'
  | 'resolved'
  | 'rejected';

export type TransactionStatus =
  | 'pending'
  | 'confirmed'
  | 'failed';

/**
 * Discriminated union of every event the stream can deliver. Handlers switch
 * on `type` so each branch is exhaustively typed.
 */
export type StreamEvent =
  | ClaimTallyEvent
  | ClaimStatusEvent
  | TransactionConfirmationEvent;

/**
 * Payload returned by the stream-token endpoint. The token is passed to the
 * `EventSource` URL so the backend can authenticate the connection.
 */
export type StreamTokenResponse = {
  token: string;
  /** Seconds until the token expires; used to refresh before reconnecting. */
  expiresIn: number;
};

/**
 * Connection lifecycle states surfaced by `useEventStream()` so consumers can
 * render a live/offline indicator.
 */
export type EventStreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'paused';

/**
 * Shape of the context value provided by the `EventStreamProvider`. One
 * connection is shared per tab, so components only read the status.
 */
export type EventStreamContextValue = {
  status: EventStreamStatus;
};

/**
 * Type guard narrowing an unknown parsed SSE payload to a `StreamEvent`.
 * Used by the provider before dispatching to the typed handlers.
 */
export function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const type = (value as { type?: unknown }).type;

  return (
    type === 'claim.tally' ||
    type === 'claim.status' ||
    type === 'transaction.confirmation'
  );
}
