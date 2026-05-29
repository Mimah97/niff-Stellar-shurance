import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EvidenceStep } from '../steps/EvidenceStep';

// NOTE: jest.mock is hoisted before variable declarations, so we use literals here.
jest.mock('@/lib/ipfs-upload', () => ({
  computeFileSha256Hex: jest.fn().mockResolvedValue(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  ),
  uploadFileWithProgress: jest.fn(),
}));

const MOCK_CID = 'QmYwAPJzv5CZsnA625s3Xf2SmxWeN4A7hh5XBnZASHxxx';
const MOCK_HASH = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const MOCK_URL = `https://ipfs.io/ipfs/${MOCK_CID}`;

function makeFile(name = 'test.png') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector('#file-upload') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('EvidenceStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows retry action on upload failure without mutating evidence list', async () => {
    const onChange = jest.fn();
    const { container } = render(<EvidenceStep evidence={[]} onChange={onChange} />);

    const { uploadFileWithProgress } = jest.requireMock('@/lib/ipfs-upload') as {
      uploadFileWithProgress: jest.Mock;
    };
    uploadFileWithProgress.mockRejectedValueOnce(new Error('Network error during upload'));

    selectFile(container, makeFile());
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('displays CID preview after successful upload', async () => {
    const onChange = jest.fn();
    const { container } = render(<EvidenceStep evidence={[]} onChange={onChange} />);

    const { uploadFileWithProgress } = jest.requireMock('@/lib/ipfs-upload') as {
      uploadFileWithProgress: jest.Mock;
    };
    uploadFileWithProgress.mockResolvedValueOnce({
      cid: MOCK_CID,
      gatewayUrls: [MOCK_URL],
      contentSha256Hex: MOCK_HASH,
    });

    selectFile(container, makeFile());
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(screen.getByTestId('cid-preview')).toHaveTextContent(MOCK_CID);
    });
  });

  it('calls onChange with cid, url, and contentSha256Hex on success', async () => {
    const onChange = jest.fn();
    const { container } = render(<EvidenceStep evidence={[]} onChange={onChange} />);

    const { uploadFileWithProgress } = jest.requireMock('@/lib/ipfs-upload') as {
      uploadFileWithProgress: jest.Mock;
    };
    uploadFileWithProgress.mockResolvedValueOnce({
      cid: MOCK_CID,
      gatewayUrls: [MOCK_URL],
      contentSha256Hex: MOCK_HASH,
    });

    selectFile(container, makeFile());
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        { cid: MOCK_CID, url: MOCK_URL, contentSha256Hex: MOCK_HASH },
      ]);
    });
  });

  it('shows min-evidence error when evidence count is below minimum', () => {
    render(<EvidenceStep evidence={[]} onChange={jest.fn()} minEvidence={2} maxEvidence={5} />);
    expect(
      screen.getByText(/at least 2 files required before proceeding/i),
    ).toBeInTheDocument();
  });

  it('shows max-evidence message when at limit', () => {
    const evidence = [
      { cid: 'Qm1', url: 'https://ipfs.io/ipfs/Qm1', contentSha256Hex: 'a'.repeat(64) },
      { cid: 'Qm2', url: 'https://ipfs.io/ipfs/Qm2', contentSha256Hex: 'b'.repeat(64) },
    ];
    render(<EvidenceStep evidence={evidence} onChange={jest.fn()} minEvidence={1} maxEvidence={2} />);
    expect(screen.getByText(/maximum of 2 files reached/i)).toBeInTheDocument();
  });

  it('retries upload successfully after initial failure', async () => {
    const onChange = jest.fn();
    const { container } = render(<EvidenceStep evidence={[]} onChange={onChange} />);

    const { uploadFileWithProgress } = jest.requireMock('@/lib/ipfs-upload') as {
      uploadFileWithProgress: jest.Mock;
    };
    uploadFileWithProgress
      .mockRejectedValueOnce(new Error('Network error during upload'))
      .mockResolvedValueOnce({
        cid: MOCK_CID,
        gatewayUrls: [MOCK_URL],
        contentSha256Hex: MOCK_HASH,
      });

    selectFile(container, makeFile());
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByTestId('cid-preview')).toHaveTextContent(MOCK_CID);
    });
    expect(onChange).toHaveBeenCalledWith([
      { cid: MOCK_CID, url: MOCK_URL, contentSha256Hex: MOCK_HASH },
    ]);
  });

  it('does not corrupt evidence list when upload is cancelled before starting', () => {
    const onChange = jest.fn();
    const existingEvidence = [
      { cid: 'QmExisting', url: 'https://ipfs.io/ipfs/QmExisting', contentSha256Hex: 'c'.repeat(64) },
    ];
    const { container } = render(
      <EvidenceStep evidence={existingEvidence} onChange={onChange} />,
    );

    selectFile(container, makeFile('new.png'));

    // Cancel before uploading (no cid yet, so onChange should not be called)
    fireEvent.click(screen.getByRole('button', { name: /remove new\.png/i }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
