/**
 * @jest-environment jsdom
 *
 * Tests for the /admin/assets page — asset allowlist management.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock auth
// ---------------------------------------------------------------------------
const mockJwt = btoa(JSON.stringify({ role: 'admin' }))

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ jwt: `header.${mockJwt}.sig` }),
}))

// ---------------------------------------------------------------------------
// Mock admin API
// ---------------------------------------------------------------------------
const mockListAssets = jest.fn()
const mockSetAssetAllowed = jest.fn()
const mockRemoveAsset = jest.fn()
const mockAddAsset = jest.fn()

jest.mock('@/lib/api/admin', () => ({
  adminApi: {
    listAssets: (...a: unknown[]) => mockListAssets(...a),
    setAssetAllowed: (...a: unknown[]) => mockSetAssetAllowed(...a),
    removeAsset: (...a: unknown[]) => mockRemoveAsset(...a),
    addAsset: (...a: unknown[]) => mockAddAsset(...a),
  },
}))

// ---------------------------------------------------------------------------
// Mock next/link and next-intl
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
import AdminAssetsPage from '../page'

const SAMPLE_ASSETS = [
  { id: '1', contractId: 'CUSDC123', symbol: 'USDC', decimals: 7, isAllowed: true },
  { id: '2', contractId: 'CXLM456', symbol: 'XLM', decimals: 7, isAllowed: false },
]

describe('AdminAssetsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the list of allowed assets', async () => {
    mockListAssets.mockResolvedValue(SAMPLE_ASSETS)

    render(<AdminAssetsPage />)

    await waitFor(() => {
      expect(screen.getByText('USDC')).toBeInTheDocument()
      expect(screen.getByText('XLM')).toBeInTheDocument()
    })

    expect(screen.getByText('CUSDC123')).toBeInTheDocument()
  })

  it('shows a loading spinner while fetching', () => {
    mockListAssets.mockReturnValue(new Promise(() => {})) // never resolves
    render(<AdminAssetsPage />)
    expect(screen.getByLabelText('Loading assets')).toBeInTheDocument()
  })

  it('shows an error message when fetch fails', async () => {
    mockListAssets.mockRejectedValue(new Error('Network error'))

    render(<AdminAssetsPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })

  it('toggles asset allowed status on switch click', async () => {
    mockListAssets.mockResolvedValue(SAMPLE_ASSETS)
    mockSetAssetAllowed.mockResolvedValue({ ...SAMPLE_ASSETS[0], isAllowed: false })

    render(<AdminAssetsPage />)

    await waitFor(() => {
      expect(screen.getByText('USDC')).toBeInTheDocument()
    })

    const toggle = screen.getByRole('switch', { name: /toggle USDC/i })

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(mockSetAssetAllowed).toHaveBeenCalledWith(
      expect.any(String),
      '1',
      false,
    )
  })

  it('opens the add asset dialog and submits a new asset', async () => {
    mockListAssets.mockResolvedValue([])
    mockAddAsset.mockResolvedValue({ id: '3', contractId: 'CNEW789', symbol: 'NEW', decimals: 7, isAllowed: true })

    render(<AdminAssetsPage />)

    await waitFor(() => {
      expect(screen.getByText(/No assets configured yet/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /add asset/i }))

    await waitFor(() => {
      expect(screen.getByLabelText('Contract ID')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Contract ID'), { target: { value: 'CNEW789' } })
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'new' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add asset$/i }))
    })

    expect(mockAddAsset).toHaveBeenCalledWith(
      expect.any(String),
      { contractId: 'CNEW789', symbol: 'NEW', decimals: 7 },
    )
  })

  it('shows authentication required when not logged in', () => {
    // Temporarily override the mock to return no JWT
    const useAuthMock = jest.requireMock('@/lib/hooks/useAuth')
    const original = useAuthMock.useAuth
    useAuthMock.useAuth = () => ({ jwt: null })

    const { container } = render(<AdminAssetsPage />)
    expect(container.textContent).toMatch(/authentication required/i)

    useAuthMock.useAuth = original
  })
})
