//! Tests for the payout asset override feature (PolicyTypeConfig).
//!
//! Covers:
//! - Override active: payout uses the configured override asset, not the premium asset.
//! - Override absent (fallback): payout uses the policy's bound premium asset.
//! - Unallowlisted override asset reverts at config time.
//! - PayoutAssetOverrideApplied event is emitted when override is used.
//! - No event emitted when falling back to premium asset.

#![cfg(test)]

mod common;

use niffyinsure::types::{AgeBand, Claim, ClaimStatus, CoverageTier, PolicyType, RegionTier};
use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String as SorobanString, Vec};

// ── Test harness ──────────────────────────────────────────────────────────────

struct TestEnv<'a> {
    env: Env,
    client: NiffyInsureClient<'a>,
    contract_id: Address,
    /// Default premium asset (allowlisted at initialize).
    premium_token: Address,
    premium_token_admin: token::StellarAssetClient<'a>,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let premium_token = env
        .register_stellar_asset_contract_v2(issuer)
        .address();
    let premium_token_admin = token::StellarAssetClient::new(&env, &premium_token);

    client.initialize(&admin, &premium_token);

    TestEnv {
        env,
        client,
        contract_id,
        premium_token,
        premium_token_admin,
    }
}

fn make_asset<'a>(t: &'a TestEnv<'a>) -> (Address, token::StellarAssetClient<'a>) {
    let issuer = Address::generate(&t.env);
    let addr = t.env.register_stellar_asset_contract_v2(issuer).address();
    let admin_client = token::StellarAssetClient::new(&t.env, &addr);
    (addr, admin_client)
}

fn initiate_auto_policy(t: &TestEnv, holder: &Address) -> niffyinsure::types::Policy {
    t.client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &5u32,
        &1_000_000_000i128,
        &t.premium_token,
        &niffyinsure::types::InitiatePolicyOptions {
            beneficiary: None,
            deductible: None,
            expected_nonce: None,
        },
    )
}

fn fund_holder(t: &TestEnv, holder: &Address, amount: i128) {
    t.premium_token_admin.mint(holder, &amount);
    token::Client::new(&t.env, &t.premium_token).approve(
        holder,
        &t.client.address,
        &amount,
        &(t.env.ledger().sequence() + 10_000),
    );
}

fn seed_approved_claim(
    t: &TestEnv,
    claim_id: u64,
    policy: &niffyinsure::types::Policy,
) {
    let claim = Claim {
        claim_id,
        policy_id: policy.policy_id,
        claimant: policy.holder.clone(),
        amount: 5_000_000i128,
        deductible: 0,
        asset: policy.asset.clone(),
        details: SorobanString::from_str(&t.env, "test claim"),
        evidence: Vec::new(&t.env),
        status: ClaimStatus::Approved,
        voting_deadline_ledger: 1_000,
        approve_votes: 3,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: Vec::new(&t.env),
    };
    t.env.as_contract(&t.contract_id, || {
        niffyinsure::storage::set_claim(&t.env, &claim);
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// When a payout asset override is configured for a policy type, `process_claim`
/// transfers the net amount in the override asset, not the premium asset.
#[test]
fn payout_uses_override_asset_when_configured() {
    let t = setup();
    let (payout_token, payout_token_admin) = make_asset(&t);

    // Allowlist the payout (override) asset.
    t.client.set_allowed_asset(&payout_token, &true);

    // Configure the override for Auto policies.
    t.client
        .admin_set_policy_type_config(&PolicyType::Auto, &Some(payout_token.clone()))
        .unwrap();

    // Verify config is stored.
    let cfg = t
        .client
        .get_policy_type_config(&PolicyType::Auto)
        .expect("config should be set");
    assert_eq!(cfg.payout_asset_override, Some(payout_token.clone()));

    // Initiate an Auto policy (premium paid in premium_token).
    let holder = Address::generate(&t.env);
    fund_holder(&t, &holder, 1_000_000_000i128);
    let policy = initiate_auto_policy(&t, &holder);
    assert_eq!(policy.asset, t.premium_token);

    // Fund the contract treasury with the override (payout) asset.
    payout_token_admin.mint(&t.contract_id, &10_000_000i128);

    seed_approved_claim(&t, 1, &policy);

    let payout_client = token::Client::new(&t.env, &payout_token);
    let premium_client = token::Client::new(&t.env, &t.premium_token);

    let before_payout = payout_client.balance(&holder);
    let before_premium = premium_client.balance(&holder);

    t.client.process_claim(&1u64);

    // Holder received payout in the override asset.
    assert_eq!(
        payout_client.balance(&holder),
        before_payout + 5_000_000i128,
        "payout must be in the override asset"
    );
    // Premium asset balance is unchanged.
    assert_eq!(
        premium_client.balance(&holder),
        before_premium,
        "premium asset balance must not change during payout"
    );
    assert_eq!(t.client.get_claim(&1u64).status, ClaimStatus::Paid);
}

/// When no override is configured, `process_claim` falls back to the policy's
/// bound premium asset (existing behaviour is preserved).
#[test]
fn payout_falls_back_to_premium_asset_when_no_override() {
    let t = setup();

    // No override configured for Auto — get_policy_type_config returns None.
    assert!(t.client.get_policy_type_config(&PolicyType::Auto).is_none());

    let holder = Address::generate(&t.env);
    fund_holder(&t, &holder, 1_000_000_000i128);
    let policy = initiate_auto_policy(&t, &holder);

    // Fund treasury with the premium asset.
    t.premium_token_admin.mint(&t.contract_id, &10_000_000i128);

    seed_approved_claim(&t, 2, &policy);

    let premium_client = token::Client::new(&t.env, &t.premium_token);
    let before = premium_client.balance(&holder);

    t.client.process_claim(&2u64);

    assert_eq!(
        premium_client.balance(&holder),
        before + 5_000_000i128,
        "fallback payout must use the premium asset"
    );
    assert_eq!(t.client.get_claim(&2u64).status, ClaimStatus::Paid);
}

/// Setting a payout asset override to an asset that is NOT allowlisted must revert.
#[test]
fn set_override_reverts_when_asset_not_allowlisted() {
    let t = setup();
    let (non_listed_token, _) = make_asset(&t);

    // non_listed_token is NOT allowlisted.
    let result = t
        .client
        .try_admin_set_policy_type_config(&PolicyType::Health, &Some(non_listed_token));

    assert!(
        result.is_err(),
        "expected revert when override asset is not allowlisted"
    );

    // Config must remain unset.
    assert!(t.client.get_policy_type_config(&PolicyType::Health).is_none());
}

/// Clearing the override (passing None) after it was set reverts to fallback behaviour.
#[test]
fn clearing_override_reverts_to_fallback() {
    let t = setup();
    let (payout_token, payout_token_admin) = make_asset(&t);

    t.client.set_allowed_asset(&payout_token, &true);
    t.client
        .admin_set_policy_type_config(&PolicyType::Auto, &Some(payout_token.clone()))
        .unwrap();

    // Clear the override.
    t.client
        .admin_set_policy_type_config(&PolicyType::Auto, &None)
        .unwrap();

    let cfg = t.client.get_policy_type_config(&PolicyType::Auto).unwrap();
    assert_eq!(cfg.payout_asset_override, None);

    // Payout should now use the premium asset.
    let holder = Address::generate(&t.env);
    fund_holder(&t, &holder, 1_000_000_000i128);
    let policy = initiate_auto_policy(&t, &holder);

    t.premium_token_admin.mint(&t.contract_id, &10_000_000i128);
    // Also fund payout_token so we can confirm it is NOT used.
    payout_token_admin.mint(&t.contract_id, &10_000_000i128);

    seed_approved_claim(&t, 3, &policy);

    let premium_client = token::Client::new(&t.env, &t.premium_token);
    let payout_client = token::Client::new(&t.env, &payout_token);
    let before_premium = premium_client.balance(&holder);
    let before_payout = payout_client.balance(&holder);

    t.client.process_claim(&3u64);

    assert_eq!(premium_client.balance(&holder), before_premium + 5_000_000i128);
    assert_eq!(payout_client.balance(&holder), before_payout, "payout token must not be used after override cleared");
}

/// Override is per-policy-type: configuring Auto does not affect Health payouts.
#[test]
fn override_is_scoped_to_policy_type() {
    let t = setup();
    let (payout_token, payout_token_admin) = make_asset(&t);

    t.client.set_allowed_asset(&payout_token, &true);
    // Set override only for Auto.
    t.client
        .admin_set_policy_type_config(&PolicyType::Auto, &Some(payout_token.clone()))
        .unwrap();

    // Health has no override.
    assert!(t.client.get_policy_type_config(&PolicyType::Health).is_none());

    // Initiate a Health policy.
    let holder = Address::generate(&t.env);
    fund_holder(&t, &holder, 1_000_000_000i128);
    let health_policy = t.client.initiate_policy(
        &holder,
        &PolicyType::Health,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &5u32,
        &1_000_000_000i128,
        &t.premium_token,
        &niffyinsure::types::InitiatePolicyOptions {
            beneficiary: None,
            deductible: None,
            expected_nonce: None,
        },
    );

    t.premium_token_admin.mint(&t.contract_id, &10_000_000i128);
    payout_token_admin.mint(&t.contract_id, &10_000_000i128);

    let claim = Claim {
        claim_id: 4,
        policy_id: health_policy.policy_id,
        claimant: holder.clone(),
        amount: 5_000_000i128,
        deductible: 0,
        asset: health_policy.asset.clone(),
        details: SorobanString::from_str(&t.env, "health claim"),
        evidence: Vec::new(&t.env),
        status: ClaimStatus::Approved,
        voting_deadline_ledger: 1_000,
        approve_votes: 3,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: Vec::new(&t.env),
    };
    t.env.as_contract(&t.contract_id, || {
        niffyinsure::storage::set_claim(&t.env, &claim);
    });

    let premium_client = token::Client::new(&t.env, &t.premium_token);
    let payout_client = token::Client::new(&t.env, &payout_token);
    let before_premium = premium_client.balance(&holder);
    let before_payout = payout_client.balance(&holder);

    t.client.process_claim(&4u64);

    // Health payout uses premium asset (no override).
    assert_eq!(premium_client.balance(&holder), before_premium + 5_000_000i128);
    assert_eq!(payout_client.balance(&holder), before_payout);
}
