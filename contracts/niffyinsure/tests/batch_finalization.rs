//! #580 — Batch claim finalization: keeper processes multiple expired deadlines in one call.

#![cfg(test)]

use niffyinsure::{
    types::{ClaimStatus, VoteOption},
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

fn file(
    env: &Env,
    client: &NiffyInsureClient,
    holder: &Address,
) -> u64 {
    let details = String::from_str(env, "batch test");
    let urls = vec![env];
    client.file_claim(holder, &1u32, &100_000i128, &details, &urls, &None)
}

// ── Over-cap reverts before any processing ────────────────────────────────────

#[test]
fn over_cap_reverts_before_processing() {
    let (env, client, _, _) = setup();
    // Build a vec of 21 claim IDs (cap is 20).
    let mut ids = soroban_sdk::Vec::new(&env);
    for i in 1u64..=21 {
        ids.push_back(i);
    }
    let err = client
        .try_finalize_expired_batch(&ids)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::PolicyBatchTooLarge);
}

// ── Batch processes eligible claims and skips ineligible ones ─────────────────

#[test]
fn batch_processes_eligible_skips_ineligible() {
    let (env, client, _, _) = setup();

    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    let h3 = Address::generate(&env);
    seed(&client, &h1, 50_000);
    seed(&client, &h2, 50_000);
    seed(&client, &h3, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    // File two claims; leave h3 without a claim.
    let cid1 = file(&env, &client, &h1);
    let cid2 = file(&env, &client, &h2);

    // Advance past voting deadline.
    let deadline = client.get_claim(&cid1).voting_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline.saturating_add(1));

    // Batch: cid1 (eligible), cid2 (eligible), 999 (not found).
    let mut ids = soroban_sdk::Vec::new(&env);
    ids.push_back(cid1);
    ids.push_back(cid2);
    ids.push_back(999u64);

    let (processed, skipped) = client.finalize_expired_batch(&ids);
    assert_eq!(processed, 2);
    assert_eq!(skipped, 1);

    assert_ne!(
        client.get_claim(&cid1).status,
        ClaimStatus::Processing
    );
    assert_ne!(
        client.get_claim(&cid2).status,
        ClaimStatus::Processing
    );
}

// ── Already-finalized claims are skipped without reverting ───────────────────

#[test]
fn already_finalized_claims_are_skipped() {
    let (env, client, _, _) = setup();

    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 50_000);
    seed(&client, &h2, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    let cid1 = file(&env, &client, &h1);

    // Finalize cid1 via vote (terminal before batch).
    client.vote_on_claim(&h1, &cid1, &VoteOption::Approve);
    client.vote_on_claim(&h2, &cid1, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid1).status, ClaimStatus::Approved);

    let deadline = client.get_claim(&cid1).voting_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = deadline.saturating_add(1));

    let mut ids = soroban_sdk::Vec::new(&env);
    ids.push_back(cid1);

    // Should not revert; cid1 is already terminal → skipped.
    let (processed, skipped) = client.finalize_expired_batch(&ids);
    assert_eq!(processed, 0);
    assert_eq!(skipped, 1);
}

// ── Empty batch succeeds with zero counts ─────────────────────────────────────

#[test]
fn empty_batch_succeeds() {
    let (env, client, _, _) = setup();
    let ids = soroban_sdk::Vec::new(&env);
    let (processed, skipped) = client.finalize_expired_batch(&ids);
    assert_eq!(processed, 0);
    assert_eq!(skipped, 0);
}

// ── Batch reverts when claims_paused ─────────────────────────────────────────

#[test]
fn batch_reverts_when_claims_paused() {
    let (env, client, admin, _) = setup();
    client.pause_claims(&admin, &0u32);

    let ids = soroban_sdk::Vec::new(&env);
    let err = client
        .try_finalize_expired_batch(&ids)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::CalculatorPaused);
}

// ── Claims with voting window still open are skipped ─────────────────────────

#[test]
fn claims_with_open_voting_window_are_skipped() {
    let (env, client, _, _) = setup();

    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 50_000);
    seed(&client, &h2, 50_000);
    client.admin_set_quorum_bps(&10_000u32);

    let cid = file(&env, &client, &h1);

    // Do NOT advance past deadline — voting window still open.
    let mut ids = soroban_sdk::Vec::new(&env);
    ids.push_back(cid);

    let (processed, skipped) = client.finalize_expired_batch(&ids);
    assert_eq!(processed, 0);
    assert_eq!(skipped, 1);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Processing);
}
