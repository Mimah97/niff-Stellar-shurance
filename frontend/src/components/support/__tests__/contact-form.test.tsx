/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

import { ContactForm } from '../contact-form'
import { submitSupportTicket } from '@/lib/api/support'

jest.mock('@/lib/api/support', () => ({
  submitSupportTicket: jest.fn(),
}))

// Mock CaptchaWidget so tests can control captcha state
jest.mock('../captcha-widget', () => ({
  CaptchaWidget: ({ onVerify }: { onVerify: (token: string) => void; onExpire?: () => void }) => (
    <button type="button" onClick={() => onVerify('test-captcha-token')} data-testid="captcha-verify">
      Verify CAPTCHA
    </button>
  ),
}))

const mockSubmit = submitSupportTicket as jest.MockedFunction<typeof submitSupportTicket>

describe('ContactForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders all form fields', () => {
    render(<ContactForm />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/subject/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/message/i)).toBeInTheDocument()
  })

  it('disables submit button when CAPTCHA is not completed', () => {
    render(<ContactForm />)
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled()
  })

  it('enables submit button after CAPTCHA is verified', async () => {
    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    expect(screen.getByRole('button', { name: /send message/i })).not.toBeDisabled()
  })

  it('shows validation errors for empty required fields', async () => {
    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(screen.getByText(/valid email required/i)).toBeInTheDocument()
    })
  })

  it('shows validation error for short subject', async () => {
    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com')
    await userEvent.type(screen.getByLabelText(/subject/i), 'Hi')
    await userEvent.type(screen.getByLabelText(/message/i), 'A'.repeat(20))
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(screen.getByText(/at least 5 characters/i)).toBeInTheDocument()
    })
  })

  it('shows validation error for short message', async () => {
    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com')
    await userEvent.type(screen.getByLabelText(/subject/i), 'My subject here')
    await userEvent.type(screen.getByLabelText(/message/i), 'Short')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(screen.getByText(/at least 20 characters/i)).toBeInTheDocument()
    })
  })

  it('shows success state with ticket reference after successful submission', async () => {
    mockSubmit.mockResolvedValueOnce({ id: 'TICKET-12345', status: 'open' })

    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com')
    await userEvent.type(screen.getByLabelText(/subject/i), 'My test subject')
    await userEvent.type(screen.getByLabelText(/message/i), 'This is a detailed message with enough characters.')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(screen.getByText(/message received/i)).toBeInTheDocument()
    })
    expect(screen.getByText('TICKET-12345')).toBeInTheDocument()
  })

  it('shows error message on submission failure', async () => {
    mockSubmit.mockRejectedValueOnce(new Error('Server error'))

    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com')
    await userEvent.type(screen.getByLabelText(/subject/i), 'My test subject')
    await userEvent.type(screen.getByLabelText(/message/i), 'This is a detailed message with enough characters.')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument()
    })
  })

  it('passes captcha token to submit function', async () => {
    mockSubmit.mockResolvedValueOnce({ id: 'TICKET-99', status: 'open' })

    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    await userEvent.type(screen.getByLabelText(/email/i), 'user@test.com')
    await userEvent.type(screen.getByLabelText(/subject/i), 'Testing CAPTCHA flow')
    await userEvent.type(screen.getByLabelText(/message/i), 'This message is long enough to pass validation.')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ captchaToken: 'test-captcha-token' })
      )
    })
  })

  it('returns to idle state after clicking send another', async () => {
    mockSubmit.mockResolvedValueOnce({ id: 'TICKET-42', status: 'open' })

    render(<ContactForm />)
    await userEvent.click(screen.getByTestId('captcha-verify'))
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com')
    await userEvent.type(screen.getByLabelText(/subject/i), 'My test subject')
    await userEvent.type(screen.getByLabelText(/message/i), 'This is a detailed message with enough characters.')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(screen.getByText(/message received/i)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /send another/i }))
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument()
  })
})
