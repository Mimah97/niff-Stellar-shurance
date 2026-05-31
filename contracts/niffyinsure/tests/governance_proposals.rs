#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    let holder_a = Address::generate(&env);
    let holder_b = Address::generate(&env);
    client.test_seed_policy(&holder_a, &1u32, &1_000_000i128, &500_000u32);
    client.test_seed_policy(&holder_b, &1u32, &1_000_000i128, &500_000u32);
    (env, client, holder_a, holder_b, admin)
}

#[test]
fn token_holder_can_create_proposal() {
    let (env, client, holder, _, _) = setup();
    let id = client.create_proposal(&holder, &String::from_str(&env, "quorum_bps"), &6_000u32);
    let proposal = client.get_proposal(&id).expect("proposal stored");

    assert_eq!(proposal.param_key, String::from_str(&env, "quorum_bps"));
    assert_eq!(proposal.proposed_value, 6_000u32);
    assert_eq!(proposal.approve_votes, 0);
    assert_eq!(proposal.reject_votes, 0);
}

#[test]
fn quorum_applies_parameter_change() {
    let (env, client, holder_a, holder_b, _) = setup();
    let id = client.create_proposal(
        &holder_a,
        &String::from_str(&env, "quorum_bps"),
        &7_000u32,
    );

    client.vote_proposal(&holder_a, &id, &true);
    assert_eq!(client.get_quorum_bps(), 5_000u32);
    client.vote_proposal(&holder_b, &id, &true);

    assert_eq!(client.get_quorum_bps(), 7_000u32);
    assert!(client.get_proposal(&id).expect("proposal retained").applied);
}

#[test]
fn rejected_proposal_is_discarded_without_applying() {
    let (env, client, holder_a, holder_b, _) = setup();
    let before = client.get_vote_duration_ledgers();
    let id = client.create_proposal(
        &holder_a,
        &String::from_str(&env, "voting_duration_ledgers"),
        &10_000u32,
    );

    client.vote_proposal(&holder_a, &id, &false);
    client.vote_proposal(&holder_b, &id, &false);

    assert_eq!(client.get_vote_duration_ledgers(), before);
    assert!(client.get_proposal(&id).is_none());
}

#[test]
fn non_token_holder_cannot_create_proposal() {
    let (env, client, _, _, _) = setup();
    let outsider = Address::generate(&env);

    assert!(client
        .try_create_proposal(
            &outsider,
            &String::from_str(&env, "quorum_bps"),
            &6_000u32,
        )
        .is_err());
}

#[test]
fn duplicate_votes_are_rejected() {
    let (env, client, holder_a, _, _) = setup();
    let id = client.create_proposal(&holder_a, &String::from_str(&env, "quorum_bps"), &6_000u32);

    client.vote_proposal(&holder_a, &id, &true);
    assert!(client.try_vote_proposal(&holder_a, &id, &true).is_err());
}
