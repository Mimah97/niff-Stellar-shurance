import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { EvidenceStep } from '../steps/EvidenceStep'

jest.mock('@/lib/ipfs-upload', () => ({
  computeFileSha256Hex: jest.fn().mockResolvedValue(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  ),
  uploadFileWithProgress: jest.fn(),
}))

describe('EvidenceStep', () => {
  it('shows retry action on upload failure without mutating evidence list', async () => {
    const onChange = jest.fn()
    const { container } = render(<EvidenceStep evidence={[]} onChange={onChange} />)

    const fileInput = container.querySelector('#file-upload') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    const { uploadFileWithProgress } = jest.requireMock('@/lib/ipfs-upload') as {
      uploadFileWithProgress: jest.Mock
    }
    uploadFileWithProgress.mockRejectedValueOnce(new Error('Network error during upload'))

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
