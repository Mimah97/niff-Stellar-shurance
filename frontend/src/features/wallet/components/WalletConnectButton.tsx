'use client'

import { useState } from 'react'
import { Copy, Check, Wallet, ChevronDown, ShieldCheck, Clock, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWallet } from '../hooks/useWallet'
import { useWhitelistStatus, type WhitelistStatus } from '../hooks/useWhitelistStatus'
import { truncateAddress } from '../utils/truncateAddress'
import { WalletConnectModal } from './WalletConnectModal'

const WHITELIST_LABEL: Record<WhitelistStatus, string> = {
  verified: 'Verified',
  pending: 'Pending',
  not_eligible: 'Not eligible',
}

const WHITELIST_CLASSES: Record<WhitelistStatus, string> = {
  verified: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  not_eligible: 'bg-red-100 text-red-800 border-red-200',
}

const WHITELIST_ICON: Record<WhitelistStatus, React.ReactNode> = {
  verified: <ShieldCheck className="h-3 w-3" aria-hidden="true" />,
  pending: <Clock className="h-3 w-3" aria-hidden="true" />,
  not_eligible: <ShieldX className="h-3 w-3" aria-hidden="true" />,
}

function WhitelistBadge({ address }: { address: string }) {
  const { data, isLoading } = useWhitelistStatus(address)

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border-muted-foreground/20 animate-pulse">
        Checking…
      </span>
    )
  }

  if (!data) return null

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${WHITELIST_CLASSES[data.status]}`}
      title={`Whitelist status: ${WHITELIST_LABEL[data.status]}`}
      role="status"
      aria-label={`Whitelist status: ${WHITELIST_LABEL[data.status]}`}
    >
      {WHITELIST_ICON[data.status]}
      {WHITELIST_LABEL[data.status]}
    </span>
  )
}

export function WalletConnectButton() {
  const { address, connectionStatus, disconnect } = useWallet()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const isConnected = connectionStatus === 'connected' && address
  const isConnecting = connectionStatus === 'connecting'
  const whitelistEnabled = process.env.NEXT_PUBLIC_WHITELIST_ENABLED === 'true'

  async function handleCopy() {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        {whitelistEnabled && <WhitelistBadge address={address} />}
        <button
          onClick={handleCopy}
          title="Click to copy address"
          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono hover:bg-accent transition-colors"
          aria-label={`Copy wallet address: ${truncateAddress(address)}`}
        >
          {truncateAddress(address)}
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
        </button>
        <Button variant="outline" size="sm" onClick={disconnect} aria-label="Disconnect wallet">
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={isConnecting}
        size="sm"
        className="gap-2"
        data-tour="connect-wallet"
      >
        <Wallet className="h-4 w-4" />
        {isConnecting ? 'Connecting…' : 'Connect Wallet'}
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      <WalletConnectModal open={open} onOpenChange={setOpen} />
    </>
  )
}
