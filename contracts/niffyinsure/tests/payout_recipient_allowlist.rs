//! Payout recipient allowlist tests.
//!
//! Covers:
//! - Standard account recipients still receive payouts.
//! - Contract recipients revert unless explicitly allowlisted.
//! - Allowlisted contract recipients receive payouts and emit a warning event.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{Claim, ClaimStatus},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, Address, Env, String as SorobanString, Vec,
};

struct TestEnv<'a> {
    env: Env,
    client: NiffyInsureClient<'a>,
    contract_id: Address,
    token: Address,
    token_admin: token::StellarAssetClient<'a>,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    let token_admin = token::StellarAssetClient::new(&env, &token);

    client.initialize(&admin, &token);

    TestEnv {
        env,
        client,
        contract_id,
        token,
        token_admin,
    }
}

fn seed_policy(t: &TestEnv, holder: &Address) -> niffyinsure::types::Policy {
    t.client.test_seed_policy(holder, &1u32, &1_000_000_000i128, &999_999u32)
}

fn seed_approved_claim(
    t: &TestEnv,
    claim_id: u64,
    policy: &niffyinsure::types::Policy,
    recipient: Option<Address>,
) {
    let mut policy = policy.clone();
    policy.beneficiary = recipient;
    t.env.as_contract(&t.contract_id, || {
        niffyinsure::storage::set_policy(&t.env, &policy.holder, policy.policy_id, &policy);
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
            payout_deadline_ledger: 0,
            approve_votes: 3,
            reject_votes: 0,
            filed_at: 100,
            eligible_voter_count: 0,
            appeal_open_deadline_ledger: 0,
            appeals_count: 0,
            appeal_deadline_ledger: 0,
            appeal_approve_votes: 0,
            appeal_reject_votes: 0,
            status_history: Vec::new(&t.env),
        };
        niffyinsure::storage::set_claim(&t.env, &claim);
    });
}

#[test]
fn account_payout_still_succeeds() {
    let t = setup();
    let holder = Address::generate(&t.env);
    let policy = seed_policy(&t, &holder);
    t.token_admin.mint(&t.contract_id, &10_000_000i128);
    seed_approved_claim(&t, 1, &policy, None);

    let before = token::Client::new(&t.env, &t.token).balance(&holder);
    t.client.process_claim(&1u64);

    assert_eq!(
        token::Client::new(&t.env, &t.token).balance(&holder),
        before + 5_000_000i128,
    );
}

#[test]
fn non_allowlisted_contract_recipient_reverts() {
    let t = setup();
    let holder = Address::generate(&t.env);
    let policy = seed_policy(&t, &holder);
    let contract_recipient = t
        .env
        .register_stellar_asset_contract_v2(Address::generate(&t.env))
        .address();
    t.token_admin.mint(&t.contract_id, &10_000_000i128);
    seed_approved_claim(&t, 2, &policy, Some(contract_recipient));

    let result = t.client.try_process_claim(&2u64);
    assert!(result.is_err());
    assert!(format!("{:?}", result).contains("PayoutRecipientContractNotAllowlisted"));
}

#[test]
fn allowlisted_contract_recipient_gets_paid_and_emits_warning() {
    let t = setup();
    let holder = Address::generate(&t.env);
    let policy = seed_policy(&t, &holder);
    let contract_recipient = t
        .env
        .register_stellar_asset_contract_v2(Address::generate(&t.env))
        .address();

    t.client
        .set_allowed_payout_recipient(&contract_recipient, &true)
        .unwrap();
    assert!(t.client.is_allowed_payout_recipient(&contract_recipient));

    t.token_admin.mint(&t.contract_id, &10_000_000i128);
    seed_approved_claim(&t, 3, &policy, Some(contract_recipient.clone()));

    let before_events = t.env.events().all().events().len();
    t.client.process_claim(&3u64);

    assert_eq!(
        token::Client::new(&t.env, &t.token).balance(&contract_recipient),
        5_000_000i128,
    );
    assert!(t.env.events().all().events().len() > before_events);
}
