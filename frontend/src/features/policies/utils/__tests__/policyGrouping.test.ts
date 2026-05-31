/**
 * @jest-environment jsdom
 */
import { classifyPolicyExpiryGroup, groupPoliciesByExpiry, EXPIRING_SOON_LEDGER_THRESHOLD } from '../policyGrouping';
import type { PolicyDto } from '@/features/policies/api';

type PartialPolicy = Partial<PolicyDto>;

const basePolicy: PolicyDto = {
  holder: 'GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE',
  policy_id: 1,
  policy_type: 'Auto',
  region: 'Medium',
  is_active: true,
  coverage_summary: {
    coverage_amount: '10000000000',
    premium_amount: '500000000',
    currency: 'XLM',
    decimals: 7,
  },
  expiry_countdown: {
    start_ledger: 1000000,
    end_ledger: 1012096,
    ledgers_remaining: 120960,
    avg_ledger_close_seconds: 5,
  },
  beneficiary: null,
  claims: [],
  _link: '/policies/1',
};

function makePolicy(overrides: Partial<PolicyDto> = {}): PolicyDto {
  return {
    ...basePolicy,
    ...overrides,
    coverage_summary: { ...basePolicy.coverage_summary, ...(overrides.coverage_summary ?? {}) },
    expiry_countdown: { ...basePolicy.expiry_countdown, ...(overrides.expiry_countdown ?? {}) },
  };
}

describe('policy grouping utilities', () => {
  it('classifies active policies when more than 7 days remain', () => {
    const policy = makePolicy({ expiry_countdown: { ledgers_remaining: EXPIRING_SOON_LEDGER_THRESHOLD + 1 } });

    expect(classifyPolicyExpiryGroup(policy)).toBe('active');
  });

  it('classifies policies as expiring soon when within 7 days', () => {
    const policy = makePolicy({ expiry_countdown: { ledgers_remaining: EXPIRING_SOON_LEDGER_THRESHOLD } });

    expect(classifyPolicyExpiryGroup(policy)).toBe('expiringSoon');
  });

  it('classifies active policies with less than 7 days remaining as expiring soon', () => {
    const policy = makePolicy({ expiry_countdown: { ledgers_remaining: 42_000 } });

    expect(classifyPolicyExpiryGroup(policy)).toBe('expiringSoon');
  });

  it('classifies inactive policies as expired regardless of remaining ledgers', () => {
    const policy = makePolicy({ is_active: false, expiry_countdown: { ledgers_remaining: EXPIRING_SOON_LEDGER_THRESHOLD + 1 } });

    expect(classifyPolicyExpiryGroup(policy)).toBe('expired');
  });

  it('groups policies into active, expiring soon, and expired buckets', () => {
    const policyA = makePolicy({ policy_id: 1, expiry_countdown: { ledgers_remaining: EXPIRING_SOON_LEDGER_THRESHOLD + 1 } });
    const policyB = makePolicy({ policy_id: 2, expiry_countdown: { ledgers_remaining: EXPIRING_SOON_LEDGER_THRESHOLD } });
    const policyC = makePolicy({ policy_id: 3, is_active: false });

    const grouped = groupPoliciesByExpiry([policyA, policyB, policyC]);

    expect(grouped.active).toEqual([policyA]);
    expect(grouped.expiringSoon).toEqual([policyB]);
    expect(grouped.expired).toEqual([policyC]);
  });
});
