/**
 * @jest-environment jsdom
 *
 * Tests for the /admin/delegations page — operator delegation manager.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock auth
// ---------------------------------------------------------------------------
const adminJwt = `header.${btoa(JSON.stringify({ role: 'admin' }))}.sig`

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ jwt: adminJwt }),
}))

// ---------------------------------------------------------------------------
// Mock admin API
// ---------------------------------------------------------------------------
const mockListDelegations = jest.fn()
const mockGrantDelegation = jest.fn()
const mockRevokeDelegation = jest.fn()

jest.mock('@/lib/api/admin', () => ({
  adminApi: {
    listDelegations: (...a: unknown[]) => mockListDelegations(...a),
    grantDelegation: (...a: unknown[]) => mockGrantDelegation(...a),
    revokeDelegation: (...a: unknown[]) => mockRevokeDelegation(...a),
  },
}))

// ---------------------------------------------------------------------------
// Mock next/link
// ---------------------------------------------------------------------------
jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
  MockLink.displayName = 'MockLink'
  return MockLink
})
jest.mock('@/config/env', () => ({
  getConfig: () => ({ apiUrl: 'http://localhost:3001', network: 'testnet' }),
}))

// ---------------------------------------------------------------------------
// Import component under test
// ---------------------------------------------------------------------------
import AdminDelegationsPage from '../page'

const NOW = new Date().toISOString()

const SAMPLE_DELEGATIONS = [
  {
    id: '1',
    delegate: 'GABC1234567890',
    expiryLedger: 5000000,
    ledgersRemaining: 10000,
    grantedAt: NOW,
    grantedBy: 'GADMIN9876543210',
  },
  {
    id: '2',
    delegate: 'GXYZ9876543210',
    expiryLedger: 4000000,
    ledgersRemaining: -5,
    grantedAt: NOW,
    grantedBy: 'GADMIN9876543210',
  },
]

describe('AdminDelegationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders active delegations in the table', async () => {
    mockListDelegations.mockResolvedValue(SAMPLE_DELEGATIONS)

    render(<AdminDelegationsPage />)

    await waitFor(() => {
      expect(screen.getByText('GABC1234567890')).toBeInTheDocument()
    })

    // Expiry ledger shown as formatted number
    expect(screen.getByText('5,000,000')).toBeInTheDocument()
  })

  it('shows a loading spinner while fetching', () => {
    mockListDelegations.mockReturnValue(new Promise(() => {}))
    render(<AdminDelegationsPage />)
    expect(screen.getByLabelText('Loading delegations')).toBeInTheDocument()
  })

  it('shows an error when fetch fails', async () => {
    mockListDelegations.mockRejectedValue(new Error('Server error'))
    render(<AdminDelegationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText('Server error')).toBeInTheDocument()
  })

  it('shows the empty state when no delegations exist', async () => {
    mockListDelegations.mockResolvedValue([])
    render(<AdminDelegationsPage />)

    await waitFor(() => {
      expect(screen.getByText(/No delegations found/i)).toBeInTheDocument()
    })
  })

  it('opens the grant dialog and submits a new delegation', async () => {
    mockListDelegations.mockResolvedValue([])
    mockGrantDelegation.mockResolvedValue({
      id: '3',
      delegate: 'GNEW1111111111',
      expiryLedger: 6000000,
      ledgersRemaining: 50000,
      grantedAt: NOW,
      grantedBy: 'GADMIN9876543210',
    })

    render(<AdminDelegationsPage />)

    await waitFor(() => {
      expect(screen.getByText(/No delegations found/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /grant delegation/i }))

    await waitFor(() => {
      expect(screen.getByLabelText('Delegate address')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Delegate address'), {
      target: { value: 'GNEW1111111111' },
    })
    fireEvent.change(screen.getByLabelText('Expiry ledger'), {
      target: { value: '6000000' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^grant delegation$/i }))
    })

    expect(mockGrantDelegation).toHaveBeenCalledWith(
      expect.any(String),
      { delegate: 'GNEW1111111111', expiryLedger: 6000000 },
    )

    // After success, the new delegation appears in the table
    await waitFor(() => {
      expect(screen.getByText('GNEW1111111111')).toBeInTheDocument()
    })
  })

  it('shows the revoke confirmation dialog and removes the delegation', async () => {
    mockListDelegations.mockResolvedValue([SAMPLE_DELEGATIONS[0]])
    mockRevokeDelegation.mockResolvedValue(undefined)

    render(<AdminDelegationsPage />)

    await waitFor(() => {
      expect(screen.getByText('GABC1234567890')).toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', { name: /revoke delegation for GABC1234567890/i }),
    )

    // Confirmation dialog appears
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    })

    expect(mockRevokeDelegation).toHaveBeenCalledWith(expect.any(String), '1')

    // Row disappears after revoke
    await waitFor(() => {
      expect(screen.queryByText('GABC1234567890')).not.toBeInTheDocument()
    })
  })

  it('shows authentication required when no JWT', () => {
    const useAuthMock = jest.requireMock('@/lib/hooks/useAuth')
    const original = useAuthMock.useAuth
    useAuthMock.useAuth = () => ({ jwt: null })

    const { container } = render(<AdminDelegationsPage />)
    expect(container.textContent).toMatch(/authentication required/i)

    useAuthMock.useAuth = original
  })
})
