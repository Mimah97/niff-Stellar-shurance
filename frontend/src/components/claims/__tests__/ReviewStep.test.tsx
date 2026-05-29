import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewStep, type PolicyCoverageDetails } from '../steps/ReviewStep';

describe('ReviewStep', () => {
  const mockOnEdit = jest.fn();

  const mockData = {
    amount: '1000',
    details: 'This is a test claim narrative documenting the incident.',
    evidence: [
      {
        cid: 'QmYwAPJzv5CZsnA625s3Xf2SmxWeN4A7hh5XBnZASHxxx',
        url: 'https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2SmxWeN4A7hh5XBnZASHxxx',
        contentSha256Hex:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        cid: 'QmABC123def456',
        url: 'https://ipfs.io/ipfs/QmABC123def456',
        contentSha256Hex:
          '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b',
      },
    ],
  };

  const mockPolicyCoverage: PolicyCoverageDetails = {
    coverageAmount: 50000000,
    currency: 'XLM',
    status: 'ACTIVE',
    expiresAt: '2027-01-01T00:00:00.000Z',
  };

  const policyId = '12345';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all claim data correctly', () => {
    render(<ReviewStep data={mockData} policyId={policyId} />);

    // Amount (1000 minor units with 7 decimals = 0.0001 XLM)
    expect(screen.getByText(/0\.0001/)).toBeInTheDocument();

    // Policy ID
    expect(screen.getByText('Policy ID: #12345')).toBeInTheDocument();

    // Narrative
    expect(
      screen.getByText('This is a test claim narrative documenting the incident.'),
    ).toBeInTheDocument();

    // Evidence count
    expect(screen.getByText('Evidence (2 files)')).toBeInTheDocument();

    // CIDs shown
    expect(
      screen.getByText('QmYwAPJzv5CZsnA625s3Xf2SmxWeN4A7hh5XBnZASHxxx'),
    ).toBeInTheDocument();
    expect(screen.getByText('QmABC123def456')).toBeInTheDocument();

    // Hashes (truncated)
    expect(screen.getByText('e3b0c44298fc1c14...7852b855')).toBeInTheDocument();
    expect(screen.getByText('01ba4719c80b6fe9...daca546b')).toBeInTheDocument();
  });

  it('renders policy coverage details when provided', () => {
    render(
      <ReviewStep data={mockData} policyId={policyId} policyCoverage={mockPolicyCoverage} />,
    );

    expect(screen.getByText('Policy Coverage')).toBeInTheDocument();
    expect(screen.getByText(/5\.00/)).toBeInTheDocument(); // 50000000 stroops = 5 XLM
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText(/2027/)).toBeInTheDocument();
  });

  it('does not render policy coverage section when omitted', () => {
    render(<ReviewStep data={mockData} policyId={policyId} />);
    expect(screen.queryByText('Policy Coverage')).not.toBeInTheDocument();
  });

  it('handles empty evidence correctly', () => {
    render(<ReviewStep data={{ ...mockData, evidence: [] }} policyId={policyId} />);
    expect(screen.getByText('Evidence (0 files)')).toBeInTheDocument();
    expect(screen.getByText('No evidence uploaded.')).toBeInTheDocument();
  });

  it('triggers onEdit(0) for evidence, onEdit(1) for amount and narrative', () => {
    render(<ReviewStep data={mockData} policyId={policyId} onEdit={mockOnEdit} />);

    fireEvent.click(screen.getByRole('button', { name: /edit claim amount/i }));
    expect(mockOnEdit).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: /edit narrative/i }));
    expect(mockOnEdit).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: /edit evidence/i }));
    expect(mockOnEdit).toHaveBeenCalledWith(0);
  });

  it('does not render Edit buttons when onEdit is not provided', () => {
    render(<ReviewStep data={mockData} policyId={policyId} />);
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });
});
