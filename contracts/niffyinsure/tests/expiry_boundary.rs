//! #586 — Coverage gap detection: revert on policy lapse before renewal.
//!
//! Boundary semantics: `[start, end)` — `now == end` means expired.
//!
//! Acceptance criteria:
//! - Claims at the exact expiry ledger revert.
//! - Claims one ledger before expiry succeed.
//! - Boundary semantics are consistent across all policy validity checks.

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageType},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
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

fn seed(client: &NiffyInsureClient, holder: &Address, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &1_000_000i128, &end_ledger);
}

fn file_claim(env: &Env, client: &NiffyInsureClient, holder: &Address) -> u64 {
    let details = String::from_str(env, "boundary test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &100_000i128, &details, &urls, &None)
}

// ── file_claim boundary: end_ledger - 1 succeeds ─────────────────────────────

#[test]
fn file_claim_one_before_expiry_succeeds() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, end);

    // now = end - 1: still within [start, end)
    env.ledger().with_mut(|l| l.sequence_number = end - 1);
    let cid = file_claim(&env, &client, &holder);
    assert!(cid > 0);
}

// ── file_claim boundary: at end_ledger reverts ────────────────────────────────

#[test]
fn file_claim_at_expiry_ledger_reverts() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, end);

    // now == end: expired (exclusive end)
    env.ledger().with_mut(|l| l.sequence_number = end);
    let err = client
        .try_file_claim(
            &holder,
            &1u32,
            &100_000i128,
            &String::from_str(&env, "x"),
            &vec![&env],
            &None,
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::PolicyExpired);
}

// ── file_claim boundary: end_ledger + 1 reverts ───────────────────────────────

#[test]
fn file_claim_one_after_expiry_reverts() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, end);

    env.ledger().with_mut(|l| l.sequence_number = end + 1);
    let err = client
        .try_file_claim(
            &holder,
            &1u32,
            &100_000i128,
            &String::from_str(&env, "x"),
            &vec![&env],
            &None,
        )
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::PolicyExpired);
}

// ── process_expired boundary: at end_ledger succeeds (policy is expired) ─────

#[test]
fn process_expired_at_end_ledger_succeeds() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, end);

    // now == end: is_expired returns true (now >= end)
    env.ledger().with_mut(|l| l.sequence_number = end);
    // process_expired should succeed (policy is expired at end_ledger)
    client.process_expired(&holder, &1u32);
}

// ── process_expired boundary: one before end_ledger reverts ──────────────────

#[test]
fn process_expired_one_before_end_ledger_reverts() {
    let (env, client, _, _) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, end);

    env.ledger().with_mut(|l| l.sequence_number = end - 1);
    let err = client
        .try_process_expired(&holder, &1u32)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, niffyinsure::policy::PolicyError::NotYetExpired);
}

// ── Renewal boundary: one before end_ledger is in renewal window ─────────────

#[test]
fn renew_one_before_end_ledger_is_in_window() {
    use niffyinsure::types::{DEFAULT_GRACE_PERIOD_LEDGERS, RENEWAL_WINDOW_LEDGERS};
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    // Use a large end_ledger so renewal window opens before it.
    let end = 100_000u32;
    seed(&client, &holder, end);

    // Mint tokens for renewal premium.
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&holder, &1_000_000_000i128);
    soroban_sdk::token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &1_000_000_000i128,
        &(end + DEFAULT_GRACE_PERIOD_LEDGERS + 1000),
    );

    // now = end - 1: inside renewal window [end - RENEWAL_WINDOW, end)
    let renewal_start = end.saturating_sub(RENEWAL_WINDOW_LEDGERS);
    env.ledger()
        .with_mut(|l| l.sequence_number = renewal_start.max(end - 1));

    let result = client.try_renew_policy(
        &holder,
        &1u32,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
    );
    // Should succeed (in renewal window).
    match result {
        Ok(Ok(_)) => {}
        other => panic!("expected renewal to succeed near end_ledger, got {other:?}"),
    }
}

// ── Renewal boundary: at end_ledger is in grace period ───────────────────────

#[test]
fn renew_at_end_ledger_is_in_grace_period() {
    use niffyinsure::types::DEFAULT_GRACE_PERIOD_LEDGERS;
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let end = 100_000u32;
    seed(&client, &holder, end);

    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&holder, &1_000_000_000i128);
    soroban_sdk::token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &1_000_000_000i128,
        &(end + DEFAULT_GRACE_PERIOD_LEDGERS + 1000),
    );

    // now == end: policy expired but within grace period
    env.ledger().with_mut(|l| l.sequence_number = end);

    let result = client.try_renew_policy(
        &holder,
        &1u32,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
    );
    // Should succeed (within grace period).
    match result {
        Ok(Ok(_)) => {}
        other => panic!("expected renewal to succeed at end_ledger (grace period), got {other:?}"),
    }
}

// ── Renewal boundary: past grace period reverts ───────────────────────────────

#[test]
fn renew_past_grace_period_returns_lapsed() {
    use niffyinsure::types::{DEFAULT_GRACE_PERIOD_LEDGERS, RenewPolicyOutcome};
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    let end = 1_000u32;
    seed(&client, &holder, end);

    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&holder, &1_000_000_000i128);
    soroban_sdk::token::Client::new(&env, &token).approve(
        &holder,
        &client.address,
        &1_000_000_000i128,
        &(end + DEFAULT_GRACE_PERIOD_LEDGERS + 1000),
    );

    // now = end + grace + 1: past grace period
    let lapsed = end.saturating_add(DEFAULT_GRACE_PERIOD_LEDGERS).saturating_add(1);
    env.ledger().with_mut(|l| l.sequence_number = lapsed);

    let result = client.try_renew_policy(
        &holder,
        &1u32,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
    );
    // Returns Ok(Lapsed) — not an error, but no renewal.
    match result {
        Ok(Ok(RenewPolicyOutcome::Lapsed)) => {}
        other => panic!("expected Lapsed, got {other:?}"),
    }
}
