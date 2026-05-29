//! Commit-reveal voting tests.
//!
//! Covers:
//!   - Valid commit-reveal sequence records vote correctly.
//!   - Wrong salt reverts with CommitmentMismatch.
//!   - Late reveal (after reveal_phase_end_ledger) reverts with RevealPhaseEnded.
//!   - Double-reveal reverts with DuplicateVote.
//!   - Commit after commit phase ends reverts with CommitPhaseEnded.
//!   - Reveal before reveal phase opens reverts with RevealPhaseNotOpen.

#![cfg(test)]

mod common;

use niffyinsure::{
    commit_reveal::{commit_vote, get_phases, reveal_vote, set_phases, CommitRevealPhases},
    types::VoteOption,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

/// Build a 32-byte salt from a single seed byte.
fn salt(env: &Env, seed: u8) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[0] = seed;
    BytesN::from_array(env, &a)
}

/// Compute SHA-256(vote_byte || salt_bytes) — mirrors the on-chain logic.
fn make_commitment(env: &Env, vote: &VoteOption, s: BytesN<32>) -> BytesN<32> {
    let vote_byte: u8 = match vote {
        VoteOption::Approve => 0x00,
        VoteOption::Reject => 0x01,
    };
    let mut preimage = Bytes::new(env);
    preimage.push_back(vote_byte);
    let salt_bytes: Bytes = s.into();
    preimage.append(&salt_bytes);
    env.crypto().sha256(&preimage).into()
}

fn default_phases(commit_end: u32, reveal_end: u32) -> CommitRevealPhases {
    CommitRevealPhases {
        commit_phase_end_ledger: commit_end,
        reveal_phase_end_ledger: reveal_end,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn valid_commit_reveal_records_vote() {
    let (env, _client, _admin) = setup();
    // ledger = 100; commit phase: 100–200, reveal phase: 201–300
    let claim_id: u64 = 1;
    let voter = Address::generate(&env);
    let s = salt(&env, 42);
    let vote = VoteOption::Approve;
    let commitment = make_commitment(&env, &vote, s.clone());

    set_phases(&env, claim_id, &default_phases(200, 300));

    // Commit at ledger 100 (within commit phase).
    commit_vote(&env, &voter, claim_id, commitment).expect("commit should succeed");

    // Advance to reveal phase.
    env.ledger().with_mut(|l| l.sequence_number = 201);

    reveal_vote(&env, &voter, claim_id, vote, s).expect("reveal should succeed");

    // Vote key must now exist in persistent storage.
    let vote_key = niffyinsure::storage::DataKey::Vote(claim_id, voter.clone());
    let recorded: VoteOption = env
        .storage()
        .persistent()
        .get(&vote_key)
        .expect("vote should be recorded");
    assert_eq!(recorded, VoteOption::Approve);
}

#[test]
fn wrong_salt_reverts_with_commitment_mismatch() {
    let (env, _client, _admin) = setup();
    let claim_id: u64 = 2;
    let voter = Address::generate(&env);
    let correct_salt = salt(&env, 1);
    let wrong_salt = salt(&env, 99);
    let vote = VoteOption::Reject;
    let commitment = make_commitment(&env, &vote, correct_salt);

    set_phases(&env, claim_id, &default_phases(200, 300));
    commit_vote(&env, &voter, claim_id, commitment).unwrap();

    env.ledger().with_mut(|l| l.sequence_number = 201);

    let err = reveal_vote(&env, &voter, claim_id, vote, wrong_salt)
        .expect_err("wrong salt should revert");
    assert_eq!(err, niffyinsure::validate::Error::CommitmentMismatch);
}

#[test]
fn late_reveal_reverts_with_reveal_phase_ended() {
    let (env, _client, _admin) = setup();
    let claim_id: u64 = 3;
    let voter = Address::generate(&env);
    let s = salt(&env, 7);
    let vote = VoteOption::Approve;
    let commitment = make_commitment(&env, &vote, s.clone());

    set_phases(&env, claim_id, &default_phases(200, 300));
    commit_vote(&env, &voter, claim_id, commitment).unwrap();

    // Advance past reveal phase end.
    env.ledger().with_mut(|l| l.sequence_number = 301);

    let err = reveal_vote(&env, &voter, claim_id, vote, s)
        .expect_err("late reveal should revert");
    assert_eq!(err, niffyinsure::validate::Error::RevealPhaseEnded);
}

#[test]
fn double_reveal_reverts_with_duplicate_vote() {
    let (env, _client, _admin) = setup();
    let claim_id: u64 = 4;
    let voter = Address::generate(&env);
    let s = salt(&env, 3);
    let vote = VoteOption::Reject;
    let commitment = make_commitment(&env, &vote, s.clone());

    set_phases(&env, claim_id, &default_phases(200, 300));
    commit_vote(&env, &voter, claim_id, commitment).unwrap();

    env.ledger().with_mut(|l| l.sequence_number = 201);

    reveal_vote(&env, &voter, claim_id, vote.clone(), s.clone()).unwrap();

    let err = reveal_vote(&env, &voter, claim_id, vote, s)
        .expect_err("double reveal should revert");
    assert_eq!(err, niffyinsure::validate::Error::DuplicateVote);
}

#[test]
fn commit_after_phase_ends_reverts() {
    let (env, _client, _admin) = setup();
    let claim_id: u64 = 5;
    let voter = Address::generate(&env);
    let s = salt(&env, 5);
    let vote = VoteOption::Approve;
    let commitment = make_commitment(&env, &vote, s);

    set_phases(&env, claim_id, &default_phases(200, 300));

    // Advance past commit phase end.
    env.ledger().with_mut(|l| l.sequence_number = 201);

    let err = commit_vote(&env, &voter, claim_id, commitment)
        .expect_err("commit after phase end should revert");
    assert_eq!(err, niffyinsure::validate::Error::CommitPhaseEnded);
}

#[test]
fn reveal_before_reveal_phase_opens_reverts() {
    let (env, _client, _admin) = setup();
    let claim_id: u64 = 6;
    let voter = Address::generate(&env);
    let s = salt(&env, 9);
    let vote = VoteOption::Reject;
    let commitment = make_commitment(&env, &vote, s.clone());

    set_phases(&env, claim_id, &default_phases(200, 300));
    commit_vote(&env, &voter, claim_id, commitment).unwrap();

    // Still in commit phase (ledger 100 <= 200).
    let err = reveal_vote(&env, &voter, claim_id, vote, s)
        .expect_err("reveal during commit phase should revert");
    assert_eq!(err, niffyinsure::validate::Error::RevealPhaseNotOpen);
}

#[test]
fn unrevealed_commitment_does_not_appear_in_vote_storage() {
    let (env, _client, _admin) = setup();
    let claim_id: u64 = 7;
    let voter = Address::generate(&env);
    let s = salt(&env, 11);
    let vote = VoteOption::Approve;
    let commitment = make_commitment(&env, &vote, s);

    set_phases(&env, claim_id, &default_phases(200, 300));
    commit_vote(&env, &voter, claim_id, commitment).unwrap();

    // Advance past reveal phase without revealing.
    env.ledger().with_mut(|l| l.sequence_number = 301);

    // Vote key must NOT exist.
    let vote_key = niffyinsure::storage::DataKey::Vote(claim_id, voter.clone());
    assert!(
        !env.storage().persistent().has(&vote_key),
        "unrevealed commitment must not affect vote tally"
    );
}
