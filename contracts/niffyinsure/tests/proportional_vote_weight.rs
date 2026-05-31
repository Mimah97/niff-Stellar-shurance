//! Tests for proportional vote weight (governance token feature).
//!
//! Covers:
//!   - Fallback to weight=1 when governance token is disabled (default)
//!   - Proportional weight equals active policy count when token enabled
//!   - Cap prevents any single voter exceeding max_weight_cap
//!   - Admin setter stores cap and emits event
//!   - Admin cannot set cap <= 0

#![cfg(test)]

use niffyinsure::{
    types::{ClaimStatus, VoteOption},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, BytesN, Env, String, Vec,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn seed_policy_n(
    client: &NiffyInsureClient,
    holder: &Address,
    policy_id: u32,
    coverage: i128,
    end_ledger: u32,
) {
    client.test_seed_policy(holder, &policy_id, &coverage, &end_ledger);
}

fn make_evidence(env: &Env) -> Vec<niffyinsure::types::ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    let mut hash = [0u8; 32];
    hash[0] = 1;
    v.push_back(niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(env, "ipfs://Qm0000000000000000000000000000000000000000000"),
        hash: BytesN::from_array(env, &hash),
    });
    v
}

fn file(client: &NiffyInsureClient, holder: &Address, env: &Env) -> u64 {
    let ev = make_evidence(env);
    client.file_claim(
        holder,
        &1u32,
        &100_000,
        &String::from_str(env, "test"),
        &ev,
        &None,
    )
}

// ── Fallback: weight = 1 when governance token disabled ───────────────────────

#[test]
fn fallback_weight_one_when_governance_token_disabled() {
    let (env, client, _, _) = setup();

    // v1 has 3 active policies, v2 has 1 — but token is disabled so both count as 1
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed_policy_n(&client, &v1, 2, 1_000_000, 500_000);
    seed_policy_n(&client, &v1, 3, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let cid = file(&client, &v1, &env);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    let claim = client.get_claim(&cid);
    // Each voter contributes weight=1 regardless of policy count
    assert_eq!(claim.approve_votes, 1);
    assert_eq!(claim.reject_votes, 1);
}

// ── Proportional weight when governance token enabled ─────────────────────────

#[cfg(feature = "governance-token")]
#[test]
fn proportional_weight_matches_active_policy_count() {
    let (env, client, _, _) = setup();

    // Enable governance token runtime flag
    client.gov_set_token_runtime_enabled(&Address::generate(&env), &true);

    // v1 has 3 active policies → weight 3; v2 has 1 → weight 1
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed_policy_n(&client, &v1, 2, 1_000_000, 500_000);
    seed_policy_n(&client, &v1, 3, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let cid = file(&client, &v1, &env);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);

    let claim = client.get_claim(&cid);
    assert_eq!(claim.approve_votes, 3, "v1 weight should be 3");
    assert_eq!(claim.reject_votes, 1, "v2 weight should be 1");
}

// ── Cap enforcement ───────────────────────────────────────────────────────────

#[cfg(feature = "governance-token")]
#[test]
fn cap_limits_whale_voter_weight() {
    let (env, client, _, _) = setup();

    client.gov_set_token_runtime_enabled(&Address::generate(&env), &true);
    // Set cap to 2 — whale with 5 policies is capped at 2
    client.admin_set_max_weight_cap(&2i128);

    let whale = Address::generate(&env);
    let small = Address::generate(&env);
    for pid in 1u32..=5 {
        seed_policy_n(&client, &whale, pid, 1_000_000, 500_000);
    }
    seed(&client, &small, 1_000_000, 500_000);

    let cid = file(&client, &whale, &env);

    client.vote_on_claim(&whale, &cid, &VoteOption::Approve);
    client.vote_on_claim(&small, &cid, &VoteOption::Reject);

    let claim = client.get_claim(&cid);
    assert_eq!(claim.approve_votes, 2, "whale capped at max_weight_cap=2");
    assert_eq!(claim.reject_votes, 1);
}

#[cfg(feature = "governance-token")]
#[test]
fn cap_at_exact_balance_is_not_reduced() {
    let (env, client, _, _) = setup();

    client.gov_set_token_runtime_enabled(&Address::generate(&env), &true);
    client.admin_set_max_weight_cap(&3i128);

    let voter = Address::generate(&env);
    seed(&client, &voter, 1_000_000, 500_000);
    seed_policy_n(&client, &voter, 2, 1_000_000, 500_000);
    seed_policy_n(&client, &voter, 3, 1_000_000, 500_000);

    let cid = file(&client, &voter, &env);
    client.vote_on_claim(&voter, &cid, &VoteOption::Approve);

    let claim = client.get_claim(&cid);
    assert_eq!(claim.approve_votes, 3, "balance == cap, no reduction");
}

// ── Admin setter ──────────────────────────────────────────────────────────────

#[test]
fn admin_set_max_weight_cap_stores_value() {
    let (_env, client, _, _) = setup();
    client.admin_set_max_weight_cap(&10i128);
    assert_eq!(client.get_max_weight_cap(), 10i128);
}

#[test]
fn admin_set_max_weight_cap_emits_event() {
    let (env, client, _, _) = setup();
    client.admin_set_max_weight_cap(&5i128);
    assert!(env.events().all().events().len() > 0);
}

#[test]
fn admin_set_max_weight_cap_rejects_zero() {
    let (_env, client, _, _) = setup();
    assert!(client.try_admin_set_max_weight_cap(&0i128).is_err());
}

#[test]
fn admin_set_max_weight_cap_rejects_negative() {
    let (_env, client, _, _) = setup();
    assert!(client.try_admin_set_max_weight_cap(&(-1i128)).is_err());
}

#[test]
fn default_max_weight_cap_is_i128_max() {
    let (_env, client, _, _) = setup();
    assert_eq!(client.get_max_weight_cap(), i128::MAX);
}
