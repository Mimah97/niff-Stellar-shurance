//! Commit-reveal voting scheme for claim DAO votes.
//!
//! # Protocol
//!
//! 1. **Commit phase** (`commit_phase_end_ledger`): voters submit
//!    `commitment = SHA-256(vote_byte || salt)` without revealing their vote.
//! 2. **Reveal phase** (`reveal_phase_end_ledger`): voters reveal `(vote, salt)`;
//!    the contract re-hashes and checks against the stored commitment.
//!
//! Unrevealed commitments are ignored in the final tally — they do not count
//! as approve or reject votes.
//!
//! # Storage keys (persistent)
//!
//! - `CommitRevealPhases(claim_id)` — phase ledger boundaries.
//! - `VoteCommitment(claim_id, voter)` — 32-byte commitment hash.
//!
//! # Error codes
//!
//! New variants are appended to `validate::Error`; see that module for the
//! full list.

use soroban_sdk::{contracttype, Address, BytesN, Env};

use crate::{storage, validate::Error};

// ── Phase storage ─────────────────────────────────────────────────────────────

/// Ledger boundaries for a single claim's commit-reveal cycle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitRevealPhases {
    /// Last ledger (inclusive) during which commitments are accepted.
    pub commit_phase_end_ledger: u32,
    /// Last ledger (inclusive) during which reveals are accepted.
    /// Must be strictly greater than `commit_phase_end_ledger`.
    pub reveal_phase_end_ledger: u32,
}

// ── DataKey extensions ────────────────────────────────────────────────────────
//
// These keys are stored in persistent storage alongside the existing claim keys.

fn phases_key(claim_id: u64) -> storage::DataKey {
    // Reuse the existing DataKey enum via a new variant added below.
    storage::DataKey::CommitRevealPhases(claim_id)
}

fn commitment_key(claim_id: u64, voter: &Address) -> storage::DataKey {
    storage::DataKey::VoteCommitment(claim_id, voter.clone())
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

pub fn set_phases(env: &Env, claim_id: u64, phases: &CommitRevealPhases) {
    let key = phases_key(claim_id);
    env.storage().persistent().set(&key, phases);
    env.storage().persistent().extend_ttl(
        &key,
        storage::PERSISTENT_TTL_THRESHOLD,
        storage::PERSISTENT_TTL_EXTEND_TO,
    );
}

pub fn get_phases(env: &Env, claim_id: u64) -> Option<CommitRevealPhases> {
    env.storage().persistent().get(&phases_key(claim_id))
}

// ── Commit ────────────────────────────────────────────────────────────────────

/// Store a voter's commitment during the commit phase.
///
/// # Errors
/// - `CommitPhaseEnded`   — current ledger > `commit_phase_end_ledger`.
/// - `DuplicateVote`      — voter already committed for this claim.
/// - `CommitRevealNotSet` — no phases configured for this claim.
pub fn commit_vote(
    env: &Env,
    voter: &Address,
    claim_id: u64,
    commitment: BytesN<32>,
) -> Result<(), Error> {
    voter.require_auth();

    let phases = get_phases(env, claim_id).ok_or(Error::CommitRevealNotSet)?;
    let now = env.ledger().sequence();

    if now > phases.commit_phase_end_ledger {
        return Err(Error::CommitPhaseEnded);
    }

    let key = commitment_key(claim_id, voter);
    if env.storage().persistent().has(&key) {
        return Err(Error::DuplicateVote);
    }

    env.storage().persistent().set(&key, &commitment);
    env.storage().persistent().extend_ttl(
        &key,
        storage::PERSISTENT_TTL_THRESHOLD,
        storage::PERSISTENT_TTL_EXTEND_TO,
    );

    Ok(())
}

// ── Reveal ────────────────────────────────────────────────────────────────────

/// Verify a voter's reveal and record their vote during the reveal phase.
///
/// The commitment must equal `SHA-256(vote_byte || salt)` where `vote_byte`
/// is `0x00` for `Approve` and `0x01` for `Reject`.
///
/// # Errors
/// - `CommitRevealNotSet`  — no phases configured for this claim.
/// - `RevealPhaseNotOpen`  — current ledger <= `commit_phase_end_ledger`.
/// - `RevealPhaseEnded`    — current ledger > `reveal_phase_end_ledger`.
/// - `CommitmentNotFound`  — voter never committed.
/// - `CommitmentMismatch`  — recomputed hash does not match stored commitment.
/// - `DuplicateVote`       — voter already revealed (Vote key exists).
pub fn reveal_vote(
    env: &Env,
    voter: &Address,
    claim_id: u64,
    vote: crate::types::VoteOption,
    salt: BytesN<32>,
) -> Result<(), Error> {
    voter.require_auth();

    let phases = get_phases(env, claim_id).ok_or(Error::CommitRevealNotSet)?;
    let now = env.ledger().sequence();

    if now <= phases.commit_phase_end_ledger {
        return Err(Error::RevealPhaseNotOpen);
    }
    if now > phases.reveal_phase_end_ledger {
        return Err(Error::RevealPhaseEnded);
    }

    // Retrieve stored commitment.
    let commit_key = commitment_key(claim_id, voter);
    let stored: BytesN<32> = env
        .storage()
        .persistent()
        .get(&commit_key)
        .ok_or(Error::CommitmentNotFound)?;

    // Prevent double-reveal: check if Vote already recorded.
    let vote_key = storage::DataKey::Vote(claim_id, voter.clone());
    if env.storage().persistent().has(&vote_key) {
        return Err(Error::DuplicateVote);
    }

    // Recompute commitment: SHA-256(vote_byte || salt_bytes).
    let vote_byte: u8 = match vote {
        crate::types::VoteOption::Approve => 0x00,
        crate::types::VoteOption::Reject => 0x01,
    };

    let mut preimage = soroban_sdk::Bytes::new(env);
    preimage.push_back(vote_byte);
    let salt_bytes: soroban_sdk::Bytes = salt.into();
    preimage.append(&salt_bytes);

    let computed: BytesN<32> = env.crypto().sha256(&preimage).into();

    if computed != stored {
        return Err(Error::CommitmentMismatch);
    }

    // Record the vote in persistent storage (same key as regular votes).
    env.storage().persistent().set(&vote_key, &vote);
    env.storage().persistent().extend_ttl(
        &vote_key,
        storage::PERSISTENT_TTL_THRESHOLD,
        storage::PERSISTENT_TTL_EXTEND_TO,
    );

    Ok(())
}
