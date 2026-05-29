import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ClaimWizard } from '../ClaimWizard';
import { useWallet } from '@/hooks/use-wallet';
import { useRouter } from 'next/navigation';
import { ClaimAPI } from '@/lib/api/claim';

jest.mock('@/hooks/use-wallet');
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/hooks/use-draft-persistence', () => ({
  useDraftPersistence: jest.fn(() => ({
    hasDraft: false,
    saveDraft: jest.fn(),
    loadDraft: jest.fn(),
    clearDraft: jest.fn(),
  })),
}));
jest.mock('@/lib/api/claim', () => ({
  ClaimAPI: {
    getConfig: jest.fn(),
    buildTransaction: jest.fn(),
    submitTransaction: jest.fn(),
  },
}));
jest.mock('@/lib/analytics', () => ({ trackClaimFiled: jest.fn() }));

const mockUseWallet = useWallet as jest.MockedFunction<typeof useWallet>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockClaimAPI = ClaimAPI as jest.Mocked<typeof ClaimAPI>;

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockWallet = {
  address: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  signTransaction: jest.fn(),
  connectionStatus: 'connected' as const,
};
const mockPolicyCoverage = {
  coverageAmount: 50000000,
  currency: 'XLM',
  status: 'ACTIVE',
  expiresAt: '2027-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRouter.mockReturnValue(mockRouter as any);
  mockUseWallet.mockReturnValue(mockWallet as any);
  mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 1, maxEvidenceCount: 5 });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function renderWizard(props?: Partial<React.ComponentProps<typeof ClaimWizard>>) {
  return render(
    <ClaimWizard
      policyId="123"
      maxCoverage="100000000"
      policyCoverage={mockPolicyCoverage}
      {...props}
    />,
  );
}

/** Navigate to the review step (step 2) with minEvidence=0 */
async function navigateToReview() {
  mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 0, maxEvidenceCount: 5 });
  renderWizard();
  // Wait for config to load
  await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());

  // Step 0 → 1 (evidence step, minEvidence=0 so Next is enabled)
  await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /next/i }));

  // Fill details
  await waitFor(() => expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument());
  fireEvent.change(screen.getByPlaceholderText(/Enter claim amount/i), {
    target: { value: '5000000' },
  });
  fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
    target: { value: 'Test narrative' },
  });

  // Step 1 → 2
  await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /next/i }));

  // Wait for review step
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /confirm & sign/i })).toBeInTheDocument(),
  );
}

// ─── Step navigation ─────────────────────────────────────────────────────────

describe('ClaimWizard – step navigation', () => {
  it('starts on Evidence step (step 0)', async () => {
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    expect(screen.getByText('Evidence Collection')).toBeInTheDocument();
  });

  it('Next button is disabled on step 0 when no evidence uploaded', async () => {
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });

  it('Back on step 0 calls router.back()', async () => {
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('shows Confirm & Sign on last step', async () => {
    mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 0, maxEvidenceCount: 5 });
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());

    // Step 0 → 1 (minEvidence=0 so Next is enabled)
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Fill details
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText(/Enter claim amount/i), {
      target: { value: '1000000' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: 'Test incident' },
    });

    // Step 1 → 2
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm & sign/i })).toBeInTheDocument(),
    );
  });

  it('Back from step 1 returns to step 0', async () => {
    mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 0, maxEvidenceCount: 5 });
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('Evidence Collection')).toBeInTheDocument();
  });
});

// ─── Contract config & evidence validation ───────────────────────────────────

describe('ClaimWizard – contract config & evidence validation', () => {
  it('fetches contract config on mount', async () => {
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalledTimes(1));
  });

  it('shows min-evidence error when no files uploaded', async () => {
    mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 2, maxEvidenceCount: 5 });
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    // The EvidenceStep renders inside the wizard; wait for it to reflect updated minEvidence
    await waitFor(() =>
      expect(
        screen.getByText(/at least 2 files required before proceeding/i),
      ).toBeInTheDocument(),
    );
  });

  it('blocks Next when evidence count is below minimum', async () => {
    mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 1, maxEvidenceCount: 5 });
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('falls back to defaults when getConfig fails', async () => {
    mockClaimAPI.getConfig.mockRejectedValue(new Error('Network error'));
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    expect(screen.getByText('Evidence Collection')).toBeInTheDocument();
    // Default minEvidence=1, so Next is disabled
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});

// ─── Details step validation ──────────────────────────────────────────────────

describe('ClaimWizard – details step', () => {
  beforeEach(() => {
    mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 0, maxEvidenceCount: 5 });
  });

  async function goToDetailsStep() {
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument(),
    );
  }

  it('Next is disabled on step 1 when amount is empty', async () => {
    await goToDetailsStep();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('Next is disabled on step 1 when narrative is empty', async () => {
    await goToDetailsStep();
    fireEvent.change(screen.getByPlaceholderText(/Enter claim amount/i), {
      target: { value: '1000000' },
    });
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('Next is enabled when both amount and narrative are filled', async () => {
    await goToDetailsStep();
    fireEvent.change(screen.getByPlaceholderText(/Enter claim amount/i), {
      target: { value: '1000000' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: 'Incident description' },
    });
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('preserves field values when navigating back and forward', async () => {
    await goToDetailsStep();
    fireEvent.change(screen.getByPlaceholderText(/Enter claim amount/i), {
      target: { value: '5000000' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: 'Preserved narrative' },
    });

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByDisplayValue('5000000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Preserved narrative')).toBeInTheDocument();
  });
});

// ─── Submission ───────────────────────────────────────────────────────────────

describe('ClaimWizard – submission', () => {
  it('calls buildTransaction and submitTransaction on Confirm & Sign', async () => {
    mockClaimAPI.buildTransaction.mockResolvedValue({ unsignedXdr: 'mock-xdr' } as any);
    mockWallet.signTransaction.mockResolvedValue('signed-xdr');
    mockClaimAPI.submitTransaction.mockResolvedValue({ claimId: 42, transactionHash: 'hash' });

    await navigateToReview();
    fireEvent.click(screen.getByRole('button', { name: /confirm & sign/i }));

    await waitFor(() => {
      expect(mockClaimAPI.buildTransaction).toHaveBeenCalledWith({
        holder: mockWallet.address,
        policyId: 123,
        amount: '5000000',
        details: 'Test narrative',
        evidence: [],
      });
      expect(mockClaimAPI.submitTransaction).toHaveBeenCalledWith('signed-xdr');
    });
  });

  it('displays claim ID and link to claim detail page on success', async () => {
    mockClaimAPI.buildTransaction.mockResolvedValue({ unsignedXdr: 'mock-xdr' } as any);
    mockWallet.signTransaction.mockResolvedValue('signed-xdr');
    mockClaimAPI.submitTransaction.mockResolvedValue({ claimId: 99, transactionHash: 'hash' });

    await navigateToReview();
    fireEvent.click(screen.getByRole('button', { name: /confirm & sign/i }));

    await waitFor(() => {
      expect(screen.getByText(/Claim ID: #99/i)).toBeInTheDocument();
    });

    const viewLink = screen.getByRole('link', { name: /view claim/i });
    expect(viewLink).toHaveAttribute('href', '/claims/99');
  });

  it('prevents duplicate submissions via submittingRef guard', async () => {
    let resolveSubmit!: (v: { claimId: number; transactionHash: string }) => void;
    mockClaimAPI.buildTransaction.mockResolvedValue({ unsignedXdr: 'mock-xdr' } as any);
    mockWallet.signTransaction.mockResolvedValue('signed-xdr');
    mockClaimAPI.submitTransaction.mockImplementation(
      () => new Promise<{ claimId: number; transactionHash: string }>(resolve => { resolveSubmit = resolve; }),
    );

    await navigateToReview();
    const confirmBtn = screen.getByRole('button', { name: /confirm & sign/i });
    fireEvent.click(confirmBtn);

    // Wait for submission to start (button becomes disabled/loading)
    await waitFor(() => expect(confirmBtn).toBeDisabled());

    // Second click while in-flight (button is disabled, but also test the ref guard)
    fireEvent.click(confirmBtn);

    await act(async () => {
      resolveSubmit({ claimId: 1, transactionHash: 'hash' });
    });

    // submitTransaction should only be called once
    expect(mockClaimAPI.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('shows error toast and re-enables button on submission failure', async () => {
    mockClaimAPI.buildTransaction.mockRejectedValue(new Error('Build failed'));

    await navigateToReview();
    fireEvent.click(screen.getByRole('button', { name: /confirm & sign/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm & sign/i })).toBeEnabled();
    });
  });

  it('does not call buildTransaction when wallet is not connected', async () => {
    // Override wallet mock to have no address
    mockUseWallet.mockReturnValue({ ...mockWallet, address: undefined } as any);

    mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 0, maxEvidenceCount: 5 });
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());

    // Navigate to review
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText(/Enter claim amount/i), {
      target: { value: '5000000' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: 'Test narrative' },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm & sign/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /confirm & sign/i }));

    await waitFor(() => {
      expect(mockClaimAPI.buildTransaction).not.toHaveBeenCalled();
    });
  });
});

// ─── Review step edit navigation ─────────────────────────────────────────────

describe('ClaimWizard – review step edit links', () => {
  beforeEach(() => {
    mockClaimAPI.getConfig.mockResolvedValue({ minEvidenceCount: 0, maxEvidenceCount: 5 });
  });

  async function goToReview() {
    renderWizard();
    await waitFor(() => expect(mockClaimAPI.getConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText(/Enter claim amount/i), {
      target: { value: '1000000' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: 'Narrative' },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm & sign/i })).toBeInTheDocument(),
    );
  }

  it('Edit evidence navigates back to step 0', async () => {
    await goToReview();
    fireEvent.click(screen.getByRole('button', { name: /edit evidence/i }));
    expect(screen.getByText('Evidence Collection')).toBeInTheDocument();
  });

  it('Edit amount navigates back to step 1', async () => {
    await goToReview();
    fireEvent.click(screen.getByRole('button', { name: /edit claim amount/i }));
    expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument();
  });
});
