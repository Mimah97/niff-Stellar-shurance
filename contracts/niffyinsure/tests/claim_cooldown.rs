//! Tests for per-policy claim cooldown.
//!
//! Covers:
//!   - First claim on a policy is never blocked (no prior resolution)
//!   - Claim within cooldown window reverts with CooldownActive
//!   - Claim after cooldown window succeeds
//!   - Cooldown=0 (default) never blocks
//!   - Admin setter stores value and emits CooldownUpdated event
//!   - Admin cannot set cooldown above MAX_COOLDOWN_LEDGERS
//!   - Cooldown is per-policy: different policy on same holder is not blocked
//!   - In-progress claims are not affected by admin cooldown updates

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

fn file(
    client: &NiffyInsureClient,
    holder: &Address,
    policy_id: u32,
    env: &Env,
) -> Result<u64, niffyinsure::validate::Error> {
    let ev = make_evidence(env);
    client
        .try_file_claim(
            holder,
            &policy_id,
            &100_000,
            &String::from_str(env, "test"),
            &ev,
            &None,
        )
        .map_err(|e| e.unwrap())
}

fn seed(client: &NiffyInsureClient, holder: &Address, policy_id: u32, end_ledger: u32) {
    client.test_seed_policy(holder, &policy_id, &1_000_000, &end_ledger);
}

/// Resolve a claim by having the single voter approve it (majority auto-finalizes).
fn resolve_claim(client: &NiffyInsureClient, voter: &Address, claim_id: u64) {
    client.vote_on_claim(voter, &claim_id, &VoteOption::Approve);
}

// ── First claim is never blocked ──────────────────────────────────────────────

#[test]
fn first_claim_not_blocked_by_cooldown() {
    let (env, client, _, _) = setup();
    client.admin_set_cooldown_ledgers(&1000u32);
    let holder = Address::generate(&env);
    seed(&client, &holder, 1, 500_000);
    // No prior resolution → cooldown does not apply
    assert!(file(&client, &holder, 1, &env).is_ok());
}

// ── Within-cooldown revert ────────────────────────────────────────────────────

#[test]
fn claim_within_cooldown_reverts() {
    let (env, client, _, _) = setup();
    let cooldown = 500u32;
    client.admin_set_cooldown_ledgers(&cooldown);

    let holder = Address::generate(&env);
    seed(&client, &holder, 1, 500_000);

    // File and resolve first claim at ledger 100
    let cid1 = file(&client, &holder, 1, &env).unwrap();
    resolve_claim(&client, &holder, cid1);
    assert_eq!(client.get_claim(&cid1).status, ClaimStatus::Approved);

    // Advance ledger but stay within cooldown window (100 + 200 < 100 + 500)
    env.ledger().with_mut(|l| l.sequence_number = 300);

    // Second claim on same policy should be blocked
    let result = file(&client, &holder, 1, &env);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), niffyinsure::validate::Error::CooldownActive);
}

// ── Post-cooldown success ─────────────────────────────────────────────────────

#[test]
fn claim_after_cooldown_succeeds() {
    let (env, client, _, _) = setup();
    let cooldown = 200u32;
    client.admin_set_cooldown_ledgers(&cooldown);

    let holder = Address::generate(&env);
    seed(&client, &holder, 1, 500_000);

    // File and resolve first claim at ledger 100
    let cid1 = file(&client, &holder, 1, &env).unwrap();
    resolve_claim(&client, &holder, cid1);

    // Advance past cooldown: 100 + 200 = 300, so ledger 300 is exactly at boundary.
    // 301 is safely past it.
    env.ledger().with_mut(|l| l.sequence_number = 301);

    assert!(file(&client, &holder, 1, &env).is_ok());
}

// ── Cooldown=0 never blocks ───────────────────────────────────────────────────

#[test]
fn zero_cooldown_never_blocks() {
    let (env, client, _, _) = setup();
    // Default is 0; explicitly set to confirm
    client.admin_set_cooldown_ledgers(&0u32);

    let holder = Address::generate(&env);
    seed(&client, &holder, 1, 500_000);

    let cid1 = file(&client, &holder, 1, &env).unwrap();
    resolve_claim(&client, &holder, cid1);

    // Immediately try again (same ledger) — should not be blocked by cooldown
    // (rate-limit may still apply, but cooldown itself is 0)
    // Advance past rate-limit window to isolate cooldown behaviour
    env.ledger().with_mut(|l| {
        l.sequence_number += niffyinsure::types::RATE_LIMIT_WINDOW_LEDGERS + 1;
    });
    assert!(file(&client, &holder, 1, &env).is_ok());
}

// ── Cooldown is per-policy ────────────────────────────────────────────────────

#[test]
fn cooldown_does_not_block_different_policy() {
    let (env, client, _, _) = setup();
    client.admin_set_cooldown_ledgers(&500u32);

    let holder = Address::generate(&env);
    seed(&client, &holder, 1, 500_000);
    seed(&client, &holder, 2, 500_000);

    // Resolve a claim on policy 1
    let cid1 = file(&client, &holder, 1, &env).unwrap();
    resolve_claim(&client, &holder, cid1);

    // Policy 2 has no prior resolution → not blocked
    assert!(file(&client, &holder, 2, &env).is_ok());
}

// ── Admin setter ──────────────────────────────────────────────────────────────

#[test]
fn admin_set_cooldown_ledgers_stores_value() {
    let (_env, client, _, _) = setup();
    client.admin_set_cooldown_ledgers(&1000u32);
    assert_eq!(client.get_cooldown_ledgers(), 1000u32);
}

#[test]
fn admin_set_cooldown_ledgers_emits_event() {
    let (env, client, _, _) = setup();
    client.admin_set_cooldown_ledgers(&500u32);
    assert!(env.events().all().events().len() > 0);
}

#[test]
fn admin_cannot_set_cooldown_above_max() {
    let (_env, client, _, _) = setup();
    // MAX_COOLDOWN_LEDGERS = 30 * 17_280 = 518_400
    let result = client.try_admin_set_cooldown_ledgers(&518_401u32);
    assert!(result.is_err());
    assert!(format!("{:?}", result).contains("CooldownLedgersOutOfBounds"));
}

#[test]
fn admin_can_set_cooldown_to_max_exactly() {
    let (_env, client, _, _) = setup();
    client.admin_set_cooldown_ledgers(&518_400u32);
    assert_eq!(client.get_cooldown_ledgers(), 518_400u32);
}

#[test]
fn default_cooldown_is_zero() {
    let (_env, client, _, _) = setup();
    assert_eq!(client.get_cooldown_ledgers(), 0u32);
}

// ── In-progress claims unaffected by admin cooldown update ───────────────────

#[test]
fn admin_cooldown_update_does_not_affect_in_progress_claim() {
    let (env, client, _, _) = setup();
    // No cooldown initially
    let holder = Address::generate(&env);
    seed(&client, &holder, 1, 500_000);

    // File claim while cooldown=0
    let cid = file(&client, &holder, 1, &env).unwrap();
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);

    // Admin sets a large cooldown after filing — in-progress claim is unaffected
    client.admin_set_cooldown_ledgers(&100_000u32);

    // Claim is still Processing (cooldown only applies at file_claim time)
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);
}
