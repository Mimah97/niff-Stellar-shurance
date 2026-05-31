//! Claim evidence updates during the pre-vote window.
//!
//! Covers:
//! - Claimants can replace evidence while the claim is still `Processing`
//!   and before any ballots are cast.
//! - Updated evidence is reflected in `get_claim`.
//! - Evidence updates are rejected once voting has started.

#![cfg(test)]

mod common;

use niffyinsure::{types::VoteOption, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, token)
}

fn seed_policy(client: &NiffyInsureClient, holder: &Address) {
    client.test_seed_policy(holder, &1u32, &1_000_000_000i128, &999_999u32);
}

#[test]
fn add_claim_evidence_succeeds_before_any_votes() {
    let (env, client, _token) = setup();
    let holder = Address::generate(&env);
    seed_policy(&client, &holder);

    let initial_evidence = common::one_url_evidence_with_hash(
        &env,
        "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        common::sample_digest(&env),
    );
    let claim_id = client.file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "roof damage"),
        &initial_evidence,
        &None,
    );

    let mut updated_evidence = common::one_url_evidence_with_hash(
        &env,
        "ipfs://bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        common::non_zero_hash(&env),
    );
    updated_evidence.push_back(niffyinsure::types::ClaimEvidenceEntry {
        url: String::from_str(
            &env,
            "https://gateway.pinata.cloud/ipfs/bafybeibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ),
        hash: common::sample_digest(&env),
    });

    let before_events = env.events().all().events().len();
    client.add_claim_evidence(&holder, &claim_id, &updated_evidence);

    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.evidence, updated_evidence);
    assert_eq!(claim.status, niffyinsure::types::ClaimStatus::Processing);
    assert!(env.events().all().events().len() > before_events);
}

#[test]
fn add_claim_evidence_reverts_after_first_vote() {
    let (env, client, _token) = setup();
    let holder = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    seed_policy(&client, &holder);
    seed_policy(&client, &voter2);
    seed_policy(&client, &voter3);

    let initial_evidence = common::one_url_evidence_with_hash(
        &env,
        "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        common::sample_digest(&env),
    );
    let claim_id = client.file_claim(
        &holder,
        &1u32,
        &100_000i128,
        &String::from_str(&env, "roof damage"),
        &initial_evidence,
        &None,
    );

    client.vote_on_claim(&holder, &claim_id, &VoteOption::Approve);

    let updated_evidence = common::one_url_evidence_with_hash(
        &env,
        "ipfs://bafybeicccccccccccccccccccccccccccccccccccccccccccccccccccc",
        common::non_zero_hash(&env),
    );

    let result = client.try_add_claim_evidence(&holder, &claim_id, &updated_evidence);
    assert!(result.is_err());
    assert!(format!("{:?}", result).contains("ClaimEvidenceUpdateNotAllowed"));
}
