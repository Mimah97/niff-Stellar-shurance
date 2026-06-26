/**
 * @jest-environment jsdom
 *
 * Tests for the ClaimCapCard / rolling claim cap progress bar rendered inside
 * PolicyDetailClient.  We test the card in isolation by rendering a minimal
 * wrapper that exercises the same query logic.
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Mock the policy API so we can control fetchClaimCap responses
// ---------------------------------------------------------------------------
const mockFetchClaimCap = jest.fn()

jest.mock('@/features/policies/api', () => ({
  ...jest.requireActual('@/features/policies/api'),
  fetchClaimCap: (...args: unknown[]) => mockFetchClaimCap(...args),
}))

// ---------------------------------------------------------------------------
// Mock dependencies of PolicyDetailClient
// ---------------------------------------------------------------------------
jest.mock('@/features/wallet', () => ({
  useWallet: () => ({ connectionStatus: 'disconnected', address: null }),
}))
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({ connectionStatus: 'disconnected', address: null }),
}))
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ jwt: null }) }))
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock('@/components/ui/print-button', () => ({ PrintButton: () => null }))
jest.mock('@/config/env', () => ({
  getConfig: () => ({ apiUrl: 'http://localhost:3001', network: 'testnet' }),
}))
// Stub out RenewModal / TerminateModal — not under test here
jest.mock('@/features/policies/components/RenewModal', () => ({ RenewModal: () => null }))
jest.mock('@/features/policies/components/TerminateModal', () => ({ TerminateModal: () => null }))

// ---------------------------------------------------------------------------
// Import component under test AFTER mocks
// ---------------------------------------------------------------------------
import { PolicyDetailClient } from '../components/PolicyDetailClient'
import type { PolicyDto } from '../api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePolicy(overrides: Partial<PolicyDto> = {}): PolicyDto {
  return {
    holder: 'GABC',
    policy_id: 1,
    policy_type: 'Auto',
    region: 'Low',
    is_active: true,
    coverage_summary: {
      coverage_amount: '1000000000',
      premium_amount: '10000000',
      currency: 'XLM',
      decimals: 7,
    },
    expiry_countdown: {
      start_ledger: 100,
      end_ledger: 200,
      ledgers_remaining: 1000,
      avg_ledger_close_seconds: 5,
    },
    claims: [],
    _link: '/api/policies/1',
    ...overrides,
  }
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ClaimCapCard — rolling claim cap progress bar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the progress bar with correct percentage and amounts', async () => {
    mockFetchClaimCap.mockResolvedValue({
      rolling_cap: '10000000000',      // 1000 XLM
      claimed_in_window: '3000000000', // 300 XLM (30%)
      window_start_ledger: 500,
      window_reset_ledger: 1500,
      window_ledgers_remaining: 1000,
    })

    renderWithQuery(<PolicyDetailClient initialPolicy={makePolicy()} policyId="1" />)

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    expect(screen.getByText(/300\.00 \/ 1000\.00 XLM/i)).toBeInTheDocument()
    expect(screen.getByText(/30\.0% used/i)).toBeInTheDocument()
  })

  it('shows the cap-nearly-exhausted alert when usage >= 90%', async () => {
    mockFetchClaimCap.mockResolvedValue({
      rolling_cap: '10000000000',
      claimed_in_window: '9500000000', // 95%
      window_start_ledger: 500,
      window_reset_ledger: 1500,
      window_ledgers_remaining: 200,
    })

    renderWithQuery(<PolicyDetailClient initialPolicy={makePolicy()} policyId="1" />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(screen.getByText(/cap nearly exhausted/i)).toBeInTheDocument()
  })

  it('does NOT show the alert when usage is below 90%', async () => {
    mockFetchClaimCap.mockResolvedValue({
      rolling_cap: '10000000000',
      claimed_in_window: '5000000000', // 50%
      window_start_ledger: 500,
      window_reset_ledger: 1500,
      window_ledgers_remaining: 500,
    })

    renderWithQuery(<PolicyDetailClient initialPolicy={makePolicy()} policyId="1" />)

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    expect(screen.queryByText(/cap nearly exhausted/i)).not.toBeInTheDocument()
  })

  it('hides the card silently when the API returns an error', async () => {
    mockFetchClaimCap.mockRejectedValue(new Error('404 Not Found'))

    renderWithQuery(<PolicyDetailClient initialPolicy={makePolicy()} policyId="1" />)

    // Give time for the query to settle
    await waitFor(() => {
      // The policy overview heading should still be present
      expect(screen.getByText(/Policy #1/i)).toBeInTheDocument()
    })

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows a reset countdown with days and ledger number', async () => {
    mockFetchClaimCap.mockResolvedValue({
      rolling_cap: '10000000000',
      claimed_in_window: '1000000000',
      window_start_ledger: 500,
      window_reset_ledger: 17280,
      window_ledgers_remaining: 17280, // ~1 day
    })

    renderWithQuery(<PolicyDetailClient initialPolicy={makePolicy()} policyId="1" />)

    await waitFor(() => {
      expect(screen.getByText(/ledger #17,280/i)).toBeInTheDocument()
    })
  })
})
