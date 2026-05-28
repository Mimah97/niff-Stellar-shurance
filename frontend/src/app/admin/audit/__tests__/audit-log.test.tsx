/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

import AdminAuditPage from '../page'
import { adminApi } from '@/lib/api/admin'

jest.mock('@/lib/api/admin', () => ({
  adminApi: {
    getAudits: jest.fn(),
    exportAuditsUrl: jest.fn(() => '/mock-export-url'),
  },
}))

// JWT needs 3 dot-separated parts so isStaff can split and parse it
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ jwt: 'header.payload.signature' }),
}))

// Mock atob so isStaff decodes the payload part as admin
jest.spyOn(global, 'atob').mockImplementation(() =>
  JSON.stringify({ role: 'admin' })
)

const mockGetAudits = adminApi.getAudits as jest.MockedFunction<typeof adminApi.getAudits>
const mockExportUrl = adminApi.exportAuditsUrl as jest.MockedFunction<typeof adminApi.exportAuditsUrl>

const makeEntry = (id: string, action: string, actor: string) => ({
  id,
  actor,
  action,
  payload: { detail: 'test' },
  createdAt: '2025-01-01T10:00:00Z',
})

const mockPage = {
  items: [
    makeEntry('1', 'CLAIM_OVERRIDE', 'GABC123'),
    makeEntry('2', 'FLAG_TOGGLE', 'GDEF456'),
  ],
  nextCursor: undefined,
}

describe('AdminAuditPage - filter state management', () => {
  // Use userEvent setup with no delay to speed up typing
  const user = userEvent.setup({ delay: null })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAudits.mockResolvedValue(mockPage)
    mockExportUrl.mockReturnValue('/mock-export-url')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('loads and displays audit entries on mount', async () => {
    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByText('CLAIM_OVERRIDE')).toBeInTheDocument()
      expect(screen.getByText('FLAG_TOGGLE')).toBeInTheDocument()
    })
  })

  it('calls getAudits with action filter when action input changes', async () => {
    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/filter by action type/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/filter by action type/i), 'CLAIM')

    // The debounce fires after 300ms in real time
    await waitFor(
      () => {
        const calls = mockGetAudits.mock.calls
        const lastCall = calls[calls.length - 1]
        expect(lastCall[1]).toMatchObject({ action: 'CLAIM' })
      },
      { timeout: 2000 },
    )
  })

  it('calls getAudits with actor filter when actor input changes', async () => {
    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/filter by actor address/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/filter by actor address/i), 'GABC')

    await waitFor(
      () => {
        const calls = mockGetAudits.mock.calls
        const lastCall = calls[calls.length - 1]
        expect(lastCall[1]).toMatchObject({ actor: 'GABC' })
      },
      { timeout: 2000 },
    )
  })

  it('calls getAudits with date range filters', async () => {
    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/filter from date/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/filter from date/i), '2025-01-01')

    await waitFor(
      () => {
        const calls = mockGetAudits.mock.calls
        const lastCall = calls[calls.length - 1]
        expect(lastCall[1]).toMatchObject({ dateFrom: '2025-01-01' })
      },
      { timeout: 2000 },
    )
  })

  it('shows load more button when nextCursor is present', async () => {
    mockGetAudits.mockResolvedValue({ ...mockPage, nextCursor: 'cursor-abc' })

    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
    })
  })

  it('appends entries when load more is clicked', async () => {
    const page1 = { items: [makeEntry('1', 'ACTION_A', 'GABC')], nextCursor: 'cursor-1' }
    const page2 = { items: [makeEntry('2', 'ACTION_B', 'GDEF')], nextCursor: undefined }

    mockGetAudits.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2)

    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByText('ACTION_A')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() => {
      expect(screen.getByText('ACTION_B')).toBeInTheDocument()
    })
    expect(screen.getByText('ACTION_A')).toBeInTheDocument()
  })

  it('shows error message when fetch fails', async () => {
    mockGetAudits.mockRejectedValueOnce(new Error('Server error'))

    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server error')
    })
  })

  it('shows empty state when no entries found', async () => {
    mockGetAudits.mockResolvedValue({ items: [], nextCursor: undefined })

    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByText(/no audit entries found/i)).toBeInTheDocument()
    })
  })

  it('renders CSV export link', async () => {
    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /export audit log as csv/i })).toBeInTheDocument()
    })
  })

  it('includes date range in export URL when filters are set', async () => {
    render(<AdminAuditPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/filter from date/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/filter from date/i), '2025-01-01')

    await waitFor(
      () => {
        expect(mockExportUrl).toHaveBeenCalledWith(
          expect.any(String),
          undefined,
          undefined,
          '2025-01-01',
          undefined,
        )
      },
      { timeout: 2000 },
    )
  })
})
