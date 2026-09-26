import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * Live updates via Server-Sent Events (issue #1525).
 *
 * A single EventSource is opened per tab and shared by every component through
 * this provider. The stream token is fetched first, then the connection is
 * opened and reconnected with exponential backoff, replaying missed events via
 * the `Last-Event-ID` header. The connection is paused while the tab is hidden
 * for a long time and resumed on focus.
 */

const HIDDEN_PAUSE_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const CLAIMS_KEY = ["claims"] as const;
const CLAIM_TALLY_KEY = ["claims", "tally"] as const;
const CLAIM_STATUS_KEY = ["claims", "status"] as const;
const TRANSACTIONS_KEY = ["transactions"] as const;

export type EventStreamStatus = "idle" | "connecting" | "open" | "paused" | "error";

export interface ClaimTallyEvent {
  type: "claim.tally";
  claimId: string;
  tally: { for: number; against: number };
}

export interface ClaimStatusEvent {
  type: "claim.status";
  claimId: string;
  status: string;
}

export interface TransactionConfirmationEvent {
  type: "transaction.confirmation";
  transactionId: string;
  confirmations: number;
  confirmed: boolean;
}

export type StreamEvent =
  | ClaimTallyEvent
  | ClaimStatusEvent
  | TransactionConfirmationEvent;

export interface EventStreamContextValue {
  status: EventStreamStatus;
  lastEventId: string | null;
}

const EventStreamContext = createContext<EventStreamContextValue>({
  status: "idle",
  lastEventId: null,
});

async function fetchStreamToken(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/events/token", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch event stream token: ${response.status}`);
  }
  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new Error("Event stream token missing from response");
  }
  return data.token;
}

function parseEvent(event: MessageEvent): StreamEvent | null {
  try {
    const parsed = JSON.parse(event.data) as StreamEvent;
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function applyEvent(queryClient: QueryClient, event: StreamEvent): void {
  switch (event.type) {
    case "claim.tally": {
      queryClient.setQueryData(CLAIM_TALLY_KEY, (previous: unknown) => ({
        ...(previous as Record<string, unknown> | undefined),
        [event.claimId]: event.tally,
      }));
      queryClient.invalidateQueries({ queryKey: CLAIMS_KEY });
      break;
    }
    case "claim.status": {
      queryClient.setQueryData(CLAIM_STATUS_KEY, (previous: unknown) => ({
        ...(previous as Record<string, unknown> | undefined),
        [event.claimId]: event.status,
      }));
      queryClient.invalidateQueries({ queryKey: CLAIMS_KEY });
      break;
    }
    case "transaction.confirmation": {
      queryClient.setQueryData(TRANSACTIONS_KEY, (previous: unknown) => {
        const list = Array.isArray(previous) ? previous : [];
        return list.map((tx) =>
          tx && typeof tx === "object" && (tx as { id?: string }).id === event.transactionId
            ? { ...(tx as object), confirmations: event.confirmations, confirmed: event.confirmed }
            : tx,
        );
      });
      queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
      break;
    }
    default:
      break;
  }
}

export function EventStreamProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EventStreamStatus>("idle");
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const disposedRef = useRef(false);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    if (disposedRef.current || pausedRef.current) {
      return;
    }
    clearReconnectTimer();
    closeSource();
    setStatus("connecting");

    const controller = new AbortController();
    let token: string;
    try {
      token = await fetchStreamToken(controller.signal);
    } catch {
      if (disposedRef.current || pausedRef.current) {
        return;
      }
      setStatus("error");
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** attemptRef.current, MAX_BACKOFF_MS);
      attemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        void connect();
      }, delay);
      return;
    }

    if (disposedRef.current || pausedRef.current) {
      return;
    }

    const url = new URL("/api/events", window.location.origin);
    url.searchParams.set("token", token);
    if (lastEventIdRef.current) {
      url.searchParams.set("lastEventId", lastEventIdRef.current);
    }

    const source = new EventSource(url.toString());
    sourceRef.current = source;

    source.onopen = () => {
      attemptRef.current = 0;
      setStatus("open");
    };

    const handleMessage = (message: MessageEvent) => {
      if (message.lastEventId) {
        lastEventIdRef.current = message.lastEventId;
        setLastEventId(message.lastEventId);
      }
      const event = parseEvent(message);
      if (event) {
        applyEvent(queryClient, event);
      }
    };

    source.onmessage = handleMessage;
    source.addEventListener("claim.tally", handleMessage as EventListener);
    source.addEventListener("claim.status", handleMessage as EventListener);
    source.addEventListener("transaction.confirmation", handleMessage as EventListener);

    source.onerror = () => {
      closeSource();
      if (disposedRef.current || pausedRef.current) {
        return;
      }
      setStatus("error");
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** attemptRef.current, MAX_BACKOFF_MS);
      attemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        void connect();
      }, delay);
    };
  }, [clearReconnectTimer, closeSource, queryClient]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearReconnectTimer();
    closeSource();
    setStatus("paused");
  }, [clearReconnectTimer, closeSource]);

  const resume = useCallback(() => {
    if (!pausedRef.current) {
      return;
    }
    pausedRef.current = false;
    attemptRef.current = 0;
    void connect();
  }, [connect]);

  useEffect(() => {
    disposedRef.current = false;
    void connect();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (hiddenTimerRef.current !== null) {
          clearTimeout(hiddenTimerRef.current);
        }
        hiddenTimerRef.current = setTimeout(() => {
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

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposedRef.current = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (hiddenTimerRef.current !== null) {
        clearTimeout(hiddenTimerRef.current);
        hiddenTimerRef.current = null;
      }
      clearReconnectTimer();
      closeSource();
    };
  }, [clearReconnectTimer, closeSource, connect, pause, resume]);

  const value = useMemo<EventStreamContextValue>(
    () => ({ status, lastEventId }),
    [status, lastEventId],
  );

  return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>;
}

export function useEventStream(): EventStreamContextValue {
  return useContext(EventStreamContext);
}
