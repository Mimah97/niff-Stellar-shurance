/**
 * @jest-environment jsdom
 *
 * Tests for the network-switcher manifest validation flow in SettingsPanel.
 * Covers:
 *  - Clicking a network button triggers validateManifestReachable
 *  - When validation fails, the network is NOT changed and an error alert is shown
 *  - When validation passes, the network changes and no error is shown
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock @/features/wallet
// ---------------------------------------------------------------------------
const mockWallet = {
  disconnect: jest.fn(),
  setAppNetwork: jest.fn(),
  address: null as string | null,
}
jest.mock('@/features/wallet', () => ({
  useWallet: () => mockWallet,
  LAST_WALLET_ID_STORAGE_KEY: 'niffyinsure:lastWalletId',
}))

// ---------------------------------------------------------------------------
// Mock @/hooks/use-wallet (shim that re-exports from features/wallet)
// ---------------------------------------------------------------------------
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => mockWallet,
}))

// ---------------------------------------------------------------------------
// Mock @/lib/hooks/useAuth
// ---------------------------------------------------------------------------
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ jwt: null }),
  setJwt: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Mock theme provider
// ---------------------------------------------------------------------------
jest.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', setTheme: jest.fn() }),
}))

// ---------------------------------------------------------------------------
// Mock onboarding tour
// ---------------------------------------------------------------------------
jest.mock('@/hooks/use-onboarding-tour', () => ({
  useOnboardingTour: () => ({ startTour: jest.fn() }),
  resetTour: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Mock @/hooks/use-settings
// ---------------------------------------------------------------------------
const mockSettings = {
  network: 'testnet' as 'testnet' | 'mainnet' | 'futurenet',
  customRpcUrl: null as string | null,
  rpcWarningAcknowledged: false,
  telemetryEnabled: false,
  displayCurrency: 'XLM' as const,
  notifications: {
    renewalRemindersEnabled: true,
    claimUpdatesEnabled: true,
    voteRemindersEnabled: true,
  },
  _v: 2,
}
const mockUpdate = jest.fn((key: string, value: unknown) => {
  if (key === 'network') {
    mockSettings.network = value as typeof mockSettings.network
  }
})
const mockReset = jest.fn()

jest.mock('@/hooks/use-settings', () => ({
  useSettings: () => ({
    settings: mockSettings,
    update: mockUpdate,
    reset: mockReset,
  }),
  useNotificationSync: () => ({ syncing: false, syncError: null }),
}))

// ---------------------------------------------------------------------------
// Mock @/lib/network-manifest
// ---------------------------------------------------------------------------
jest.mock('@/lib/network-manifest', () => ({
  getContracts: jest.fn(() => []),
}))

// ---------------------------------------------------------------------------
// Mock @/features/wallet/constants
// ---------------------------------------------------------------------------
jest.mock('@/features/wallet/constants', () => ({
  SETTINGS_NETWORK_SECTION_ID: 'settings-network',
}))

// ---------------------------------------------------------------------------
// Mock @/config/env — prevent zod validation from running in test
// ---------------------------------------------------------------------------
jest.mock('@/config/env', () => ({
  env: {
    NEXT_PUBLIC_API_URL: 'http://localhost:3001',
    NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    NEXT_PUBLIC_NETWORK: 'testnet',
  },
}))

// ---------------------------------------------------------------------------
// Mock validateManifestReachable from settings-store so we can control it
// ---------------------------------------------------------------------------
const mockValidateManifestReachable = jest.fn()

jest.mock('@/lib/settings-store', () => {
  const actual = jest.requireActual('@/lib/settings-store')
  return {
    ...actual,
    validateManifestReachable: (...args: unknown[]) => mockValidateManifestReachable(...args),
  }
})

// ---------------------------------------------------------------------------
// Import the component under test (after all mocks are set up)
// ---------------------------------------------------------------------------
import { SettingsPanel } from '../settings/settings-panel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPanel() {
  return render(<SettingsPanel />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SettingsPanel — network switcher manifest validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettings.network = 'testnet'
  })

  it('calls validateManifestReachable when a network button is clicked', async () => {
    mockValidateManifestReachable.mockResolvedValue({ reachable: true, latencyMs: 42 })

    renderPanel()
    const mainnetBtn = screen.getByRole('button', { name: /mainnet/i })

    await act(async () => {
      fireEvent.click(mainnetBtn)
    })

    expect(mockValidateManifestReachable).toHaveBeenCalledTimes(1)
    expect(mockValidateManifestReachable).toHaveBeenCalledWith('mainnet')
  })

  it('does NOT change the network when validation fails', async () => {
    mockValidateManifestReachable.mockResolvedValue({ reachable: false })

    renderPanel()
    const mainnetBtn = screen.getByRole('button', { name: /mainnet/i })

    await act(async () => {
      fireEvent.click(mainnetBtn)
    })

    // update('network', ...) must NOT have been called
    const networkCalls = mockUpdate.mock.calls.filter(([key]) => key === 'network')
    expect(networkCalls).toHaveLength(0)
    expect(mockWallet.setAppNetwork).not.toHaveBeenCalled()
  })

  it('shows an error alert when validation fails', async () => {
    mockValidateManifestReachable.mockResolvedValue({ reachable: false })

    renderPanel()
    const mainnetBtn = screen.getByRole('button', { name: /mainnet/i })

    await act(async () => {
      fireEvent.click(mainnetBtn)
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(
      screen.getByText(/cannot reach the mainnet network manifest/i),
    ).toBeInTheDocument()
  })

  it('error message mentions "Check your internet connection"', async () => {
    mockValidateManifestReachable.mockResolvedValue({ reachable: false })

    renderPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mainnet/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument()
    })
  })

  it('changes the network when validation passes', async () => {
    mockValidateManifestReachable.mockResolvedValue({ reachable: true, latencyMs: 88 })

    renderPanel()
    const mainnetBtn = screen.getByRole('button', { name: /mainnet/i })

    await act(async () => {
      fireEvent.click(mainnetBtn)
    })

    await waitFor(() => {
      const networkCalls = mockUpdate.mock.calls.filter(([key]) => key === 'network')
      expect(networkCalls).toHaveLength(1)
      expect(networkCalls[0][1]).toBe('mainnet')
    })

    expect(mockWallet.setAppNetwork).toHaveBeenCalledWith('mainnet')
  })

  it('does NOT show an error alert when validation passes', async () => {
    mockValidateManifestReachable.mockResolvedValue({ reachable: true, latencyMs: 20 })

    renderPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mainnet/i }))
    })

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled()
    })

    // The security-warning alert in the Advanced panel is not rendered by default
    // (advancedOpen is false), so no alert should be visible.
    expect(screen.queryByText(/cannot reach/i)).not.toBeInTheDocument()
  })

  it('disables all network buttons while validation is in progress', async () => {
    let resolveValidation!: (v: { reachable: boolean }) => void
    mockValidateManifestReachable.mockReturnValue(
      new Promise<{ reachable: boolean }>((res) => { resolveValidation = res }),
    )

    renderPanel()
    const mainnetBtn = screen.getByRole('button', { name: /mainnet/i })
    const testnetBtn = screen.getByRole('button', { name: /testnet/i })

    fireEvent.click(mainnetBtn)

    // While pending both buttons should be disabled
    await waitFor(() => {
      expect(mainnetBtn).toBeDisabled()
      expect(testnetBtn).toBeDisabled()
    })

    // Resolve so we don't leave dangling promises
    await act(async () => {
      resolveValidation({ reachable: true })
    })
  })

  it('re-enables network buttons after validation completes', async () => {
    mockValidateManifestReachable.mockResolvedValue({ reachable: true, latencyMs: 10 })

    renderPanel()
    const mainnetBtn = screen.getByRole('button', { name: /mainnet/i })

    await act(async () => {
      fireEvent.click(mainnetBtn)
    })

    await waitFor(() => {
      // After resolution the buttons should no longer be disabled due to validation
      expect(mainnetBtn).not.toBeDisabled()
    })
  })
})
