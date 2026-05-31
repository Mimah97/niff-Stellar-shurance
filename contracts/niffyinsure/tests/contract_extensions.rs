//! Integration tests for contract-level issue work on fraud score, asset bounds,
//! delegation, and reinsurance.
#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, DelegationPermissions, VoteOption, VOTE_WINDOW_LEDGERS},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, Env, String};

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

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token).mint(to, &amount);
}

fn approve(env: &Env, token: &Address, owner: &Address, spender: &Address, amount: i128) {
    token::Client::new(env, token).approve(owner, spender, &amount, &(env.ledger().sequence() + 10_000));
}

#[test]
fn claim_amount_bounds_rejects_outside_range_and_allows_endpoints() {
    let (env, client, _admin, token) = setup();
    let h1 = Address::generate(&env);
    let h2 = Address::generate(&env);
    seed(&client, &h1, 1_000_000, 10_000);
    seed(&client, &h2, 1_000_000, 10_000);

    client.admin_set_asset_claim_bounds(&token, &50_000i128, &200_000i128);

    let details = String::from_str(&env, "test claim");
    let ev = common::empty_evidence(&env);

    let err = client
        .try_file_claim(&h1, &1u32, &49_999i128, &details, &ev, &None)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::ClaimBelowMinAmount);

    let err = client
        .try_file_claim(&h1, &1u32, &200_001i128, &details, &ev, &None)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::ClaimAboveMaxAmount);

    let cid_min = client.file_claim(&h1, &1u32, &50_000i128, &details, &ev, &None);
    let cid_max = client.file_claim(&h2, &1u32, &200_000i128, &details, &ev, &None);

    client.admin_set_asset_claim_bounds(&token, &100_000i128, &300_000i128);

    client.vote_on_claim(&h1, &cid_min, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid_min).status, ClaimStatus::Approved);

    client.vote_on_claim(&h2, &cid_max, &VoteOption::Approve);
    assert_eq!(client.get_claim(&cid_max).status, ClaimStatus::Approved);
}

#[test]
fn expired_delegation_rejects_fraud_score_setting() {
    let (env, client, admin, _) = setup();
    let oracle = Address::generate(&env);
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &String::from_str(&env, "x"), &common::empty_evidence(&env), &None);

    let perms = DelegationPermissions {
        can_set_fraud_score: true,
        can_set_asset_config: false,
        can_set_reinsurance: false,
    };
    client.grant_delegation(&oracle, &(env.ledger().sequence() + 1), &perms);
    env.ledger().with_mut(|l| l.sequence_number += 2);

    let err = client
        .try_set_claim_fraud_score(&oracle, &cid, &60u32)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::DelegationInvalid);
}

#[test]
fn wrong_permission_on_delegation_rejects_fraud_score_setter() {
    let (env, client, _admin, _) = setup();
    let oracle = Address::generate(&env);
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &String::from_str(&env, "x"), &common::empty_evidence(&env), &None);

    let perms = DelegationPermissions {
        can_set_fraud_score: false,
        can_set_asset_config: false,
        can_set_reinsurance: false,
    };
    client.grant_delegation(&oracle, &(env.ledger().sequence() + 1), &perms);

    let err = client
        .try_set_claim_fraud_score(&oracle, &cid, &60u32)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::DelegationPermissionDenied);
}

#[test]
fn revoked_delegation_rejects_fraud_score_setter() {
    let (env, client, _admin, _) = setup();
    let oracle = Address::generate(&env);
    let holder = Address::generate(&env);
    seed(&client, &holder, 1_000_000, 10_000);
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &String::from_str(&env, "x"), &common::empty_evidence(&env), &None);

    let perms = DelegationPermissions {
        can_set_fraud_score: true,
        can_set_asset_config: false,
        can_set_reinsurance: false,
    };
    client.grant_delegation(&oracle, &(env.ledger().sequence() + 1), &perms);
    client.revoke_delegation(&oracle);

    let err = client
        .try_set_claim_fraud_score(&oracle, &cid, &60u32)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::DelegationInvalid);
}

#[test]
fn primary_treasury_succeeds_without_reinsurance() {
    let (env, client, _admin, token) = setup();
    let v1 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);

    mint(&env, &token, &client.address, &200_000i128);
    let cid = client.file_claim(&v1, &1u32, &50_000i128, &String::from_str(&env, "x"), &common::empty_evidence(&env), &None);

    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);
    let events_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", env.events().all());
    assert!(!events_debug.contains("reinsurance_drawdown"));
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

#[test]
fn insufficient_primary_uses_reinsurance_drawdown() {
    let (env, client, admin, token) = setup();
    let v1 = Address::generate(&env);
    let reinsurance = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);

    mint(&env, &token, &client.address, &30_000i128);
    mint(&env, &token, &reinsurance, &100_000i128);
    approve(&env, &token, &reinsurance, &client.address, &100_000i128);
    client.admin_set_reinsurance_contract(&reinsurance);

    let cid = client.file_claim(&v1, &1u32, &50_000i128, &String::from_str(&env, "x"), &common::empty_evidence(&env), &None);
    client.vote_on_claim(&v1, &cid, &VoteOption::Approve);

    let events_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", env.events().all());
    assert!(events_debug.contains("reinsurance_drawdown"));
    assert!(events_debug.contains("primary_amount: 30000"));
    assert!(events_debug.contains("reinsurance_amount: 20000"));
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Approved);
}

#[test]
fn no_reinsurance_reverts_when_primary_insufficient() {
    let (env, client, _admin, token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 10_000);
    seed(&client, &v2, 1_000_000, 10_000);

    mint(&env, &token, &client.address, &30_000i128);
    let cid = client.file_claim(&v1, &1u32, &50_000i128, &String::from_str(&env, "x"), &common::empty_evidence(&env), &None);

    let err = client
        .try_vote_on_claim(&v1, &cid, &VoteOption::Approve)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::NoReinsuranceConfigured);
}
