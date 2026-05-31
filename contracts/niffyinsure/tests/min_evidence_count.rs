//! Tests for minimum evidence count per claim.
//!
//! Covers:
//!   - Zero-evidence claims revert (when min > 0)
//!   - Below-min reverts with InsufficientEvidence
//!   - At-min succeeds
//!   - At-max succeeds
//!   - Above-max reverts with TooManyImageUrls
//!   - Admin cannot set min > max
//!   - Admin setter emits event
//!   - Default min is 0 (no minimum enforced)

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
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

fn make_evidence(env: &Env, count: u32) -> Vec<niffyinsure::types::ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    for i in 0..count {
        let mut hash = [0u8; 32];
        hash[0] = (i + 1) as u8;
        v.push_back(niffyinsure::types::ClaimEvidenceEntry {
            url: String::from_str(env, "ipfs://Qm0000000000000000000000000000000000000000000"),
            hash: BytesN::from_array(env, &hash),
        });
    }
    v
}

fn file_with_evidence(
    client: &NiffyInsureClient,
    holder: &Address,
    env: &Env,
    count: u32,
) -> Result<u64, niffyinsure::validate::Error> {
    let ev = make_evidence(env, count);
    client.try_file_claim(
        holder,
        &1u32,
        &100_000,
        &String::from_str(env, "test"),
        &ev,
        &None,
    )
    .map_err(|e| e.unwrap())
}

fn seed(client: &NiffyInsureClient, holder: &Address, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &1_000_000, &end_ledger);
}

// ── Default behaviour ─────────────────────────────────────────────────────────

#[test]
fn default_min_is_zero_so_zero_evidence_succeeds() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    seed(&client, &holder, 500_000);
    // min=0 by default, so zero evidence is allowed
    assert!(file_with_evidence(&client, &holder, &env, 0).is_ok());
}

#[test]
fn default_min_evidence_count_is_zero() {
    let (_env, client, _, _) = setup();
    assert_eq!(client.get_min_evidence_count(), 0u32);
}

// ── Min enforcement ───────────────────────────────────────────────────────────

#[test]
fn zero_evidence_reverts_when_min_is_one() {
    let (env, client, _, _) = setup();
    client.admin_set_min_evidence_count(&1u32);
    let holder = Address::generate(&env);
    seed(&client, &holder, 500_000);
    let result = file_with_evidence(&client, &holder, &env, 0);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), niffyinsure::validate::Error::InsufficientEvidence);
}

#[test]
fn below_min_reverts() {
    let (env, client, _, _) = setup();
    client.admin_set_min_evidence_count(&3u32);
    let holder = Address::generate(&env);
    seed(&client, &holder, 500_000);
    // 2 < 3 → InsufficientEvidence
    let result = file_with_evidence(&client, &holder, &env, 2);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), niffyinsure::validate::Error::InsufficientEvidence);
}

#[test]
fn at_min_succeeds() {
    let (env, client, _, _) = setup();
    client.admin_set_min_evidence_count(&2u32);
    let holder = Address::generate(&env);
    seed(&client, &holder, 500_000);
    assert!(file_with_evidence(&client, &holder, &env, 2).is_ok());
}

#[test]
fn at_max_succeeds() {
    let (env, client, _, _) = setup();
    // default max is 5
    let holder = Address::generate(&env);
    seed(&client, &holder, 500_000);
    assert!(file_with_evidence(&client, &holder, &env, 5).is_ok());
}

#[test]
fn above_max_reverts_with_too_many_image_urls() {
    let (env, client, _, _) = setup();
    // default max is 5
    let holder = Address::generate(&env);
    seed(&client, &holder, 500_000);
    let result = file_with_evidence(&client, &holder, &env, 6);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), niffyinsure::validate::Error::TooManyImageUrls);
}

// ── Admin setter ──────────────────────────────────────────────────────────────

#[test]
fn admin_set_min_evidence_count_stores_value() {
    let (_env, client, _, _) = setup();
    client.admin_set_min_evidence_count(&2u32);
    assert_eq!(client.get_min_evidence_count(), 2u32);
}

#[test]
fn admin_set_min_evidence_count_emits_event() {
    let (env, client, _, _) = setup();
    client.admin_set_min_evidence_count(&2u32);
    assert!(env.events().all().events().len() > 0);
}

#[test]
fn admin_cannot_set_min_greater_than_max() {
    let (_env, client, _, _) = setup();
    // default max is 5; setting min=6 should fail
    let result = client.try_admin_set_min_evidence_count(&6u32);
    assert!(result.is_err());
    assert!(format!("{:?}", result).contains("MinEvidenceExceedsMax"));
}

#[test]
fn admin_can_set_min_equal_to_max() {
    let (_env, client, _, _) = setup();
    // default max is 5
    client.admin_set_min_evidence_count(&5u32);
    assert_eq!(client.get_min_evidence_count(), 5u32);
}

#[test]
fn admin_can_set_min_to_zero() {
    let (_env, client, _, _) = setup();
    client.admin_set_min_evidence_count(&2u32);
    client.admin_set_min_evidence_count(&0u32);
    assert_eq!(client.get_min_evidence_count(), 0u32);
}
