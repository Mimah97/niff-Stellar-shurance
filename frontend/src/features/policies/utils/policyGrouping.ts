import type { PolicyDto } from '../api';

export const EXPIRING_SOON_LEDGER_THRESHOLD = 7 * 24 * 3600 / 5;

export type PolicyExpiryGroup = 'active' | 'expiringSoon' | 'expired';

export interface PolicyExpiryGroups {
  active: PolicyDto[];
  expiringSoon: PolicyDto[];
  expired: PolicyDto[];
}

export function classifyPolicyExpiryGroup(policy: PolicyDto): PolicyExpiryGroup {
  if (!policy.is_active) return 'expired';
  return policy.expiry_countdown.ledgers_remaining <= EXPIRING_SOON_LEDGER_THRESHOLD
    ? 'expiringSoon'
    : 'active';
}

export function groupPoliciesByExpiry(policies: PolicyDto[]): PolicyExpiryGroups {
  return policies.reduce<PolicyExpiryGroups>((groups, policy) => {
    const group = classifyPolicyExpiryGroup(policy);
    groups[group].push(policy);
    return groups;
  }, {
    active: [],
    expiringSoon: [],
    expired: [],
  });
}
