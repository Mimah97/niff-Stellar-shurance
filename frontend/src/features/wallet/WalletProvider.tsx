import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  xBullModule,
  AlbedoModule,
  LobstrModule,
} from '@creit.tech/stellar-wallets-kit';

const STORAGE_KEY = 'stellar.wallet.lastUsed';

/**
 * The network the app expects wallets to be connected to.
 * Override with VITE_STELLAR_NETWORK (e.g. "PUBLIC" for mainnet).
 */
export const APP_NETWORK: WalletNetwork =
  (import.meta as { env?: Record<string, string> }).env?.VITE_STELLAR_NETWORK ===
  'PUBLIC'
    ? WalletNetwork.PUBLIC
    : WalletNetwork.TESTNET;

export type WalletConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected';

export interface WalletContextValue {
  address: string | null;
  network: WalletNetwork | null;
  state: WalletConnectionState;
  isConnected: boolean;
  isConnecting: boolean;
  /** True when the wallet is on a different network than the app. */
  hasNetworkMismatch: boolean;
  /** Wallet id of the last successfully used wallet, if any. */
  lastUsedWalletId: string | null;
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

let kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: APP_NETWORK,
      selectedWalletId: readStoredWalletId() ?? undefined,
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule(),
        new LobstrModule(),
      ],
    });
  }
  return kit;
}

function readStoredWalletId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeWalletId(walletId: string | null): void {
  try {
    if (walletId) {
      window.localStorage.setItem(STORAGE_KEY, walletId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable — ignore */
  }
}

function normalizeNetwork(network: string | undefined): WalletNetwork | null {
  if (!network) return null;
  const upper = network.toUpperCase();
  if (upper === 'PUBLIC' || upper === 'MAINNET') return WalletNetwork.PUBLIC;
  if (upper === 'TESTNET') return WalletNetwork.TESTNET;
  if (upper === 'FUTURENET') return WalletNetwork.FUTURENET;
  return null;
}

interface WalletProviderProps {
  children: React.ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<WalletNetwork | null>(null);
  const [state, setState] = useState<WalletConnectionState>('disconnected');
  const [lastUsedWalletId, setLastUsedWalletId] = useState<string | null>(
    readStoredWalletId,
  );
  const reconnectAttempted = useRef(false);

  const applySession = useCallback(
    (nextAddress: string | null, nextNetwork: string | null) => {
      setAddress(nextAddress);
      setNetwork(normalizeNetwork(nextNetwork ?? undefined));
      setState(nextAddress ? 'connected' : 'disconnected');
    },
    [],
  );

  const connect = useCallback(
    async (walletId?: string) => {
      const walletKit = getKit();
      setState('connecting');
      try {
        if (walletId) {
          walletKit.setWallet(walletId);
        }
        // Connecting only reads the public key — never request signing here.
        const { address: nextAddress } = await walletKit.getAddress();
        const nextNetwork = walletKit.selectedModule?.productId
          ? APP_NETWORK
          : APP_NETWORK;
        const resolvedWalletId =
          walletId ?? walletKit.selectedModule?.productId ?? null;
        if (resolvedWalletId) {
          storeWalletId(resolvedWalletId);
          setLastUsedWalletId(resolvedWalletId);
        }
        applySession(nextAddress ?? null, nextNetwork);
      } catch (error) {
        setState('disconnected');
        throw error;
      }
    },
    [applySession],
  );

  const disconnect = useCallback(async () => {
    try {
      await getKit().disconnect();
    } catch {
      /* ignore disconnect errors */
    }
    storeWalletId(null);
    setLastUsedWalletId(null);
    applySession(null, null);
  }, [applySession]);

  // Silently reconnect the last used wallet on load.
  useEffect(() => {
    if (reconnectAttempted.current) return;
    reconnectAttempted.current = true;
    const stored = readStoredWalletId();
    if (!stored) return;
    connect(stored).catch(() => {
      storeWalletId(null);
      setLastUsedWalletId(null);
    });
  }, [connect]);

  const hasNetworkMismatch = useMemo(
    () => state === 'connected' && network !== null && network !== APP_NETWORK,
    [state, network],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      network,
      state,
      isConnected: state === 'connected',
      isConnecting: state === 'connecting',
      hasNetworkMismatch,
      lastUsedWalletId,
      connect,
      disconnect,
    }),
    [
      address,
      network,
      state,
      hasNetworkMismatch,
      lastUsedWalletId,
      connect,
      disconnect,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

export default WalletProvider;
