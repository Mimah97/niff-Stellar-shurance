import React from 'react';
import { useWallet } from './WalletProvider';
import { WalletMenu } from './WalletMenu';

export function ConnectWalletButton() {
  const { isConnected, isConnecting, connect } = useWallet();

  if (isConnected) {
    return <WalletMenu />;
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={isConnecting}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
    >
      {isConnecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  );
}
