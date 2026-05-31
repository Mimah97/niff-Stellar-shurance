//! Tests for Issue #583 — Claim fraud score: on-chain risk signal from oracle.
//!
//! Covers:
//!   - Score below threshold uses standard quorum
//!   - Score above threshold requires elevated quorum
//!   - Absent score uses standard quorum
//!   - Score setter is authenticated (admin and delegated oracle)
//!   - Unauthenticated setter is rejected
//!   - FraudScoreSet event is emitted

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, DelegationPermissions, VoteOption, VOTE_WINDOW_LEDGERS},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "test claim");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

// ── Score absent: standard quorum applies ────────────────────────────────────

#[test]
fn absent_score_uses_standard_quorum() {
    let (env, client, _, _) = setup();
    // 2 voters, default quorum 50% → 1 vote needed
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);

    let cid = file(&client, &v1, 100_000, &env);
    // No fraud score set — standard quorum (50% of 2 = 1 vote)
    assert!(client.get_claim_fraud_score(&cid).is_none());

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    // 1/2 approve with 50% quorum → approved
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

// ── Score below threshold: standard quorum applies ───────────────────────────

#[test]
fn score_below_threshold_uses_standard_quorum() {
    let (env, client, admin, _) = setup();
    // threshold = 75, elevated = 7500 bps (75%)
    client.admin_set_fraud_score_threshold(&75u32);
    client.admin_set_elevated_quorum_bps(&7500u32);

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);

    let cid = file(&client, &v1, 100_000, &env);
    // Score 50 < threshold 75 → standard quorum (50% of 2 = 1 vote)
    client.set_claim_fraud_score(&admin, &cid, &50u32);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

// ── Score above threshold: elevated quorum required ──────────────────────────

#[test]
fn score_above_threshold_requires_elevated_quorum() {
    let (env, client, admin, _) = setup();
    // threshold = 75, elevated = 10000 bps (100% — all must vote)
    client.admin_set_fraud_score_threshold(&75u32);
    client.admin_set_elevated_quorum_bps(&10_000u32);

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);

    let cid = file(&client, &v1, 100_000, &env);
    // Score 90 > threshold 75 → elevated quorum (100% of 2 = 2 votes needed)
    client.set_claim_fraud_score(&admin, &cid, &90u32);

    // Only 1 vote cast — quorum not met even with majority
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    // Still Processing because elevated quorum not met
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);

    // Second vote tips over quorum
    client.vote_on_claim(&v2, &cid, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

#[test]
fn score_above_threshold_finalize_rejects_without_quorum() {
    let (env, client, admin, _) = setup();
    client.admin_set_fraud_score_threshold(&75u32);
    client.admin_set_elevated_quorum_bps(&10_000u32);

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.set_claim_fraud_score(&admin, &cid, &90u32);

    // Only 1 of 2 votes cast
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);

    // Advance past voting deadline
    env.ledger()
        .with_mut(|l| l.sequence_number += VOTE_WINDOW_LEDGERS + 1);

    // Finalize: elevated quorum not met → Rejected
    client.finalize_claim(&cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}

// ── Authentication ────────────────────────────────────────────────────────────

#[test]
fn admin_can_set_fraud_score() {
    let (env, client, admin, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);

    client.set_claim_fraud_score(&admin, &cid, &80u32);
    assert_eq!(client.get_claim_fraud_score(&cid), Some(80u32));
}

#[test]
fn delegated_oracle_can_set_fraud_score() {
    let (env, client, admin, _) = setup();
    let oracle = Address::generate(&env);
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);

    let perms = DelegationPermissions {
        can_set_fraud_score: true,
        can_set_asset_config: false,
        can_set_reinsurance: false,
    };
    client.grant_delegation(&oracle, &5000u32, &perms);

    client.set_claim_fraud_score(&oracle, &cid, &60u32);
    assert_eq!(client.get_claim_fraud_score(&cid), Some(60u32));

    let _ = admin; // admin used to initialize
}

#[test]
fn undelegated_caller_cannot_set_fraud_score() {
    let (env, client, _, _) = setup();
    let outsider = Address::generate(&env);
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);

    assert!(client
        .try_set_claim_fraud_score(&outsider, &cid, &80u32)
        .is_err());
}

#[test]
fn set_claim_fraud_score_emits_event() {
    let (env, client, admin, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = file(&client, &holder, 100_000, &env);

    env.events().all();
    client.set_claim_fraud_score(&admin, &cid, &80u32);

    let events_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", env.events().all());
    assert!(events_debug.contains("claim_fraud_score_set"));
}
