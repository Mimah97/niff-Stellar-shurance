import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

/**
 * Live updates via Server-Sent Events (issue #1525).
 *
 * A single EventSource is opened per tab and shared by every component through
 * the `EventStreamProvider`. Incoming events patch the React Query cache so
 * claim tallies, statuses and transaction confirmations update live.
 */

export type ClaimTallyEvent = {
  type: 'claim.tally';
  claimId: string;
  forVotes: number;
  againstVotes: number;
};

export type ClaimStatusEvent = {
  type: 'claim.status';
  claimId: string;
  status: string;
};

export type TransactionConfirmationEvent = {
  type: 'transaction.confirmation';
  txHash: string;
  confirmations: number;
  confirmed: boolean;
};

export type EventStreamEvent =
  | ClaimTallyEvent
  | ClaimStatusEvent
  | TransactionConfirmationEvent;

export type EventStreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'paused'
  | 'error';

export type EventStreamContextValue = {
  status: EventStreamStatus;
  lastEventId: string | null;
};

const EventStreamContext = createContext<EventStreamContextValue>({
  status: 'idle',
  lastEventId: null,
});

/** How long the tab must stay hidden before we pause the stream. */
const HIDDEN_PAUSE_MS = 60_000;
const BASE_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

const STREAM_TOKEN_ENDPOINT = '/api/events/token';
const STREAM_ENDPOINT = '/api/events';

async function fetchStreamToken(signal: AbortSignal): Promise<string> {
  const res = await fetch(STREAM_TOKEN_ENDPOINT, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch event stream token: ${res.status}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error('Event stream token response missing token');
  }
  return data.token;
}

function applyEvent(queryClient: QueryClient, event: EventStreamEvent): void {
  switch (event.type) {
    case 'claim.tally': {
      queryClient.setQueryData(
        ['claim', event.claimId, 'tally'],
        { forVotes: event.forVotes, againstVotes: event.againstVotes },
      );
      queryClient.invalidateQueries({ queryKey: ['claim', event.claimId] });
      break;
    }
    case 'claim.status': {
      queryClient.setQueryData(
        ['claim', event.claimId, 'status'],
        event.status,
      );
      queryClient.invalidateQueries({ queryKey: ['claim', event.claimId] });
      queryClient.invalidateQueries({ queryKey: ['claims'] });
      break;
    }
    case 'transaction.confirmation': {
      queryClient.setQueryData(
        ['transaction', event.txHash],
        { confirmations: event.confirmations, confirmed: event.confirmed },
      );
      if (event.confirmed) {
        queryClient.invalidateQueries({ queryKey: ['transaction', event.txHash] });
      }
      break;
    }
    default: {
      // Exhaustiveness guard: unknown events are ignored.
      break;
    }
  }
}

function parseEvent(raw: MessageEvent<string>): EventStreamEvent | null {
  try {
    const parsed = JSON.parse(raw.data) as EventStreamEvent;
    if (parsed && typeof parsed.type === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function EventStreamProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EventStreamStatus>('idle');
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    const abort = new AbortController();

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const closeSource = () => {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposedRef.current || pausedRef.current) return;
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposedRef.current || pausedRef.current) return;
      closeSource();
      setStatus('connecting');
      try {
        const token = await fetchStreamToken(abort.signal);
        if (disposedRef.current || pausedRef.current) return;

        const url = new URL(STREAM_ENDPOINT, window.location.origin);
        url.searchParams.set('token', token);
        const source = new EventSource(url.toString());
        sourceRef.current = source;

        source.onopen = () => {
          reconnectAttemptsRef.current = 0;
          setStatus('open');
        };

        source.onmessage = (raw: MessageEvent<string>) => {
          if (raw.lastEventId) {
            lastEventIdRef.current = raw.lastEventId;
            setLastEventId(raw.lastEventId);
          }
          const event = parseEvent(raw);
          if (event) {
            applyEvent(queryClient, event);
          }
        };

        source.onerror = () => {
          closeSource();
          if (disposedRef.current || pausedRef.current) return;
          setStatus('error');
          scheduleReconnect();
        };
      } catch (err) {
        if (abort.signal.aborted || disposedRef.current || pausedRef.current) return;
        setStatus('error');
        scheduleReconnect();
      }
    };

    const pause = () => {
      if (pausedRef.current) return;
      pausedRef.current = true;
      clearReconnectTimer();
      closeSource();
      setStatus('paused');
    };

    const resume = () => {
      if (!pausedRef.current) return;
      pausedRef.current = false;
      reconnectAttemptsRef.current = 0;
      void connect();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (hiddenTimerRef.current !== null) return;
        hiddenTimerRef.current = setTimeout(() => {
          hiddenTimerRef.current = null;
          pause();
        }, HIDDEN_PAUSE_MS);
      } else {
        if (hiddenTimerRef.current !== null) {
          clearTimeout(hiddenTimerRef.current);
          hiddenTimerRef.current = null;
        }
        resume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void connect();

    return () => {
      disposedRef.current = true;
      abort.abort();
      clearReconnectTimer();
      if (hiddenTimerRef.current !== null) {
        clearTimeout(hiddenTimerRef.current);
        hiddenTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      closeSource();
    };
  }, [queryClient]);

  const value = useMemo<EventStreamContextValue>(
    () => ({ status, lastEventId }),
    [status, lastEventId],
  );

  return (
    <EventStreamContext.Provider value={value}>
      {children}
    </EventStreamContext.Provider>
  );
}

export function useEventStream(): EventStreamContextValue {
  return useContext(EventStreamContext);
}
