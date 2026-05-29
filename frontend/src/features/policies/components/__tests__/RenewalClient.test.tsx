/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { RenewalClient } from '../RenewalClient'
import type { PolicyDto } from '../../api'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/config/env', () => ({
  getConfig: () => ({ apiUrl: 'http://localhost:3001' }),
}))

const mockWallet = {
  address: 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE' as string | null,
  signTransaction: jest.fn(),
  connectionStatus: 'connected' as const,
}
jest.mock('@/features/wallet', () => ({
  useWallet: () => mockWallet,
}))

const mockGeneratePremium = jest.fn()
jest.mock('@/lib/api/quote', () => ({
  generatePremium: (...args: unknown[]) => mockGeneratePremium(...args),
}))

const mockInitiateRenewal = jest.fn()
const mockSubmitTransaction = jest.fn()
jest.mock('@/lib/api/policy', () => ({
  PolicyAPI: {
    initiateRenewal: (...args: unknown[]) => mockInitiateRenewal(...args),
    submitTransaction: (...args: unknown[]) => mockSubmitTransaction(...args),
  },
  PolicyError: class PolicyError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
  getPolicyErrorMessage: (e: { message: string }) => e.message,
}))

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const basePolicy: PolicyDto = {
  holder: 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE',
  policy_id: 42,
  policy_type: 'Auto',
  region: 'Medium',
  is_active: true,
  coverage_summary: {
    coverage_amount: '10000000000', // 1000 XLM
    premium_amount: '500000000',    // 50 XLM
    currency: 'XLM',
    decimals: 7,
  },
  expiry_countdown: {
    start_ledger: 1000000,
    end_ledger: 1050000,
    ledgers_remaining: 40000,
    avg_ledger_close_seconds: 5,
  },
  beneficiary: null,
  claims: [],
  _link: '/policies/42',
}

const defaultPremiumResponse = {
  premiumStroops: '500000000',
  premiumXlm: '50',
  minResourceFee: '100',
  source: 'simulation' as const,
  inputs: { policy_type: 'Auto', region: 'Medium', age: 30, risk_score: 5 },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

async function renderRenewal(policy = basePolicy) {
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <QueryClientProvider client={makeClient()}>
        <RenewalClient policy={policy} policyId={String(policy.policy_id)} />
      </QueryClientProvider>,
    )
  })
  return result!
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RenewalClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWallet.address = 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE'
    mockGeneratePremium.mockResolvedValue(defaultPremiumResponse)
  })

  // ── Pre-fill tests ──────────────────────────────────────────────────────────

  it('pre-fills policy type from existing policy', async () => {
    await renderRenewal()
    // Policy type appears in both "Current Coverage" and "Renewal Summary" sections
    expect(screen.getAllByText('Auto').length).toBeGreaterThanOrEqual(1)
  })

  it('pre-fills region from existing policy', async () => {
    await renderRenewal()
    expect(screen.getAllByText('Medium').length).toBeGreaterThanOrEqual(1)
  })

  it('pre-fills current coverage amount', async () => {
    await renderRenewal()
    // formatXlm renders with 2 decimal places: "1,000.00 XLM"
    expect(screen.getByText(/1,000\.00/)).toBeInTheDocument()
  })

  it('pre-fills current premium amount', async () => {
    await renderRenewal()
    // The dd element contains "50.00" and " XLM/yr" as separate text nodes
    const premiumDd = screen.getByText('Current Premium').closest('div')!.querySelector('dd')
    expect(premiumDd?.textContent).toMatch(/50\.00/)
  })

  it('shows the policy id in the heading', async () => {
    await renderRenewal()
    expect(screen.getByRole('heading', { name: /Renew Policy #42/i })).toBeInTheDocument()
  })

  it('links back to the policy detail page', async () => {
    await renderRenewal()
    const link = screen.getByRole('link', { name: /Policy #42/i })
    expect(link).toHaveAttribute('href', '/policies/42')
  })

  // ── Coverage tier select ────────────────────────────────────────────────────

  it('renders coverage tier select with all options', async () => {
    await renderRenewal()
    const select = screen.getByLabelText(/coverage tier/i)
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Basic' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Standard' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Premium' })).toBeInTheDocument()
  })

  // ── Live premium recalculation ──────────────────────────────────────────────

  it('calls generatePremium with current policy fields on mount', async () => {
    await renderRenewal()
    await waitFor(() => {
      expect(mockGeneratePremium).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_type: 'Auto',
          region: 'Medium',
        }),
      )
    })
  })

  it('displays recalculated premium after load', async () => {
    await renderRenewal()
    await waitFor(() => {
      // The renewal summary shows "50.00 XLM/yr" after premium loads
      expect(screen.getAllByText(/50\.00 XLM\/yr/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('recalculates premium when tier changes', async () => {
    mockGeneratePremium
      .mockResolvedValueOnce(defaultPremiumResponse)
      .mockResolvedValueOnce({
        ...defaultPremiumResponse,
        premiumStroops: '300000000',
        premiumXlm: '30',
      })

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalledTimes(1))

    const select = screen.getByLabelText(/coverage tier/i)
    // Default tier is Premium (inferred from fixture); change to Basic to trigger recalc
    await act(async () => {
      fireEvent.change(select, { target: { value: 'Basic' } })
    })

    await waitFor(() => {
      expect(mockGeneratePremium).toHaveBeenCalledTimes(2)
      expect(mockGeneratePremium).toHaveBeenLastCalledWith(
        expect.objectContaining({ coverage_tier: 'Basic' }),
      )
    })
  })

  it('shows loading indicator while recalculating', async () => {
    // Use a never-resolving promise so the loading state persists
    mockGeneratePremium.mockReturnValue(new Promise(() => { /* never resolves */ }))

    render(
      <QueryClientProvider client={makeClient()}>
        <RenewalClient policy={basePolicy} policyId="42" />
      </QueryClientProvider>,
    )

    // Loading indicator should be visible immediately (before promise resolves)
    expect(screen.getByText(/Calculating/i)).toBeInTheDocument()
  })

  // ── Wallet / transaction flow ───────────────────────────────────────────────

  it('calls initiateRenewal with correct args on submit', async () => {
    mockInitiateRenewal.mockResolvedValue({ transactionXdr: 'xdr123', transactionId: 't1', fee: 100, network: 'TESTNET', expiresAt: '' })
    mockWallet.signTransaction.mockResolvedValue('signed-xdr')
    mockSubmitTransaction.mockResolvedValue({ policyId: '42', transactionHash: 'hash123' })

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalled())

    await act(async () => {
      screen.getByRole('button', { name: /Sign & Renew/i }).closest('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })

    await waitFor(() => {
      expect(mockInitiateRenewal).toHaveBeenCalledWith({
        holder: basePolicy.holder,
        policyId: basePolicy.policy_id,
        walletAddress: mockWallet.address,
        coverageTier: expect.any(String),
      })
    })
  })

  it('calls signTransaction with the XDR from initiateRenewal', async () => {
    mockInitiateRenewal.mockResolvedValue({ transactionXdr: 'xdr-abc', transactionId: 't1', fee: 100, network: 'TESTNET', expiresAt: '' })
    mockWallet.signTransaction.mockResolvedValue('signed-xdr-abc')
    mockSubmitTransaction.mockResolvedValue({ policyId: '42', transactionHash: 'hash456' })

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalled())

    await act(async () => {
      screen.getByRole('button', { name: /Sign & Renew/i }).closest('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })

    await waitFor(() => {
      expect(mockWallet.signTransaction).toHaveBeenCalledWith('xdr-abc')
    })
  })

  it('calls submitTransaction with signed XDR', async () => {
    mockInitiateRenewal.mockResolvedValue({ transactionXdr: 'xdr-abc', transactionId: 't1', fee: 100, network: 'TESTNET', expiresAt: '' })
    mockWallet.signTransaction.mockResolvedValue('signed-xdr-abc')
    mockSubmitTransaction.mockResolvedValue({ policyId: '42', transactionHash: 'hash789' })

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalled())

    await act(async () => {
      screen.getByRole('button', { name: /Sign & Renew/i }).closest('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })

    await waitFor(() => {
      expect(mockSubmitTransaction).toHaveBeenCalledWith('signed-xdr-abc', '')
    })
  })

  // ── Successful renewal redirect ─────────────────────────────────────────────

  it('shows success state and redirects to policy detail page after successful renewal', async () => {
    mockInitiateRenewal.mockResolvedValue({ transactionXdr: 'xdr', transactionId: 't1', fee: 100, network: 'TESTNET', expiresAt: '' })
    mockWallet.signTransaction.mockResolvedValue('signed')
    mockSubmitTransaction.mockResolvedValue({ policyId: '42', transactionHash: 'txhash' })

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalled())

    await act(async () => {
      screen.getByRole('button', { name: /Sign & Renew/i }).closest('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })

    await waitFor(() => {
      expect(screen.getByText(/Renewal submitted/i)).toBeInTheDocument()
    })

    await act(async () => {
      screen.getByRole('button', { name: /View Policy/i }).click()
    })
    expect(mockPush).toHaveBeenCalledWith('/policies/42')
  })

  it('shows transaction hash after successful renewal', async () => {
    mockInitiateRenewal.mockResolvedValue({ transactionXdr: 'xdr', transactionId: 't1', fee: 100, network: 'TESTNET', expiresAt: '' })
    mockWallet.signTransaction.mockResolvedValue('signed')
    mockSubmitTransaction.mockResolvedValue({ policyId: '42', transactionHash: 'abc123hash' })

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalled())

    await act(async () => {
      screen.getByRole('button', { name: /Sign & Renew/i }).closest('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })

    await waitFor(() => {
      expect(screen.getByText(/abc123hash/)).toBeInTheDocument()
    })
  })

  // ── Renewal with tier upgrade ───────────────────────────────────────────────

  it('submits with the selected tier (downgrade to Standard)', async () => {
    mockInitiateRenewal.mockResolvedValue({ transactionXdr: 'xdr', transactionId: 't1', fee: 100, network: 'TESTNET', expiresAt: '' })
    mockWallet.signTransaction.mockResolvedValue('signed')
    mockSubmitTransaction.mockResolvedValue({ policyId: '42', transactionHash: 'hash' })

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalled())

    const select = screen.getByLabelText(/coverage tier/i)
    await act(async () => {
      fireEvent.change(select, { target: { value: 'Standard' } })
    })

    await act(async () => {
      screen.getByRole('button', { name: /Sign & Renew/i }).closest('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })

    await waitFor(() => {
      expect(mockInitiateRenewal).toHaveBeenCalledWith(
        expect.objectContaining({ coverageTier: 'Standard' }),
      )
    })
  })

  // ── Error handling ──────────────────────────────────────────────────────────

  it('shows error message when renewal fails', async () => {
    mockInitiateRenewal.mockRejectedValue(new Error('Insufficient balance'))

    await renderRenewal()
    await waitFor(() => expect(mockGeneratePremium).toHaveBeenCalled())

    await act(async () => {
      screen.getByRole('button', { name: /Sign & Renew/i }).closest('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })

    await waitFor(() => {
      expect(screen.getByText(/Insufficient balance/i)).toBeInTheDocument()
    })
  })

  it('disables submit button when wallet is not connected', async () => {
    mockWallet.address = null
    await renderRenewal()
    expect(screen.getByRole('button', { name: /Sign & Renew/i })).toBeDisabled()
  })
})
