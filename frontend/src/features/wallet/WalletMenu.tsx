import React, { useState } from 'react';
import { useWallet } from './WalletProvider';

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function WalletMenu() {
  const { address, network, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  const explorerBase =
    network === 'PUBLIC'
      ? 'https://stellar.expert/explorer/public/account/'
      : 'https://stellar.expert/explorer/testnet/account/';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={address}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        {truncateAddress(address)}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={handleCopy}
            className="block w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            {copied ? 'Copied!' : 'Copy address'}
          </button>
          <a
            href={`${explorerBase}${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            View on explorer
          </a>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
            className="block w-full rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-100"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
