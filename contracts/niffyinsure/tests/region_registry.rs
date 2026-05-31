//! Tests for the admin-managed region registry and its enforcement in initiate_policy.
#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionConfig, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::Address as _,
    Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

fn opts_with_code(env: &Env, code: &str) -> InitiatePolicyOptions {
    InitiatePolicyOptions {
        beneficiary: None,
        deductible: None,
        expected_nonce: None,
        region_code: Some(String::from_str(env, code)),
    }
}

fn opts_no_code() -> InitiatePolicyOptions {
    InitiatePolicyOptions {
        beneficiary: None,
        deductible: None,
        expected_nonce: None,
        region_code: None,
    }
}

fn active_config(env: &Env) -> RegionConfig {
    RegionConfig {
        parent: String::from_str(env, ""),
        risk_multiplier: 10_000,
        active: true,
    }
}

fn inactive_config(env: &Env) -> RegionConfig {
    RegionConfig {
        parent: String::from_str(env, ""),
        risk_multiplier: 10_000,
        active: false,
    }
}

// ── Registry management ───────────────────────────────────────────────────────

#[test]
fn admin_can_add_and_query_region() {
    let (env, client, _admin, _token) = setup();
    let code = String::from_str(&env, "US-CA");
    let config = active_config(&env);
    client.admin_set_region(&code, &config);
    let got = client.get_region_config(&code).unwrap();
    assert_eq!(got.active, true);
    assert_eq!(got.risk_multiplier, 10_000);
}

#[test]
fn admin_can_deactivate_region() {
    let (env, client, _admin, _token) = setup();
    let code = String::from_str(&env, "US-CA");
    client.admin_set_region(&code, &active_config(&env));
    client.admin_set_region(&code, &inactive_config(&env));
    let got = client.get_region_config(&code).unwrap();
    assert!(!got.active);
}

#[test]
fn admin_can_remove_region() {
    let (env, client, _admin, _token) = setup();
    let code = String::from_str(&env, "US-CA");
    client.admin_set_region(&code, &active_config(&env));
    client.admin_remove_region(&code);
    assert!(client.get_region_config(&code).is_none());
}

// ── initiate_policy with empty registry (no validation) ──────────────────────

#[test]
fn initiate_policy_succeeds_when_registry_empty_and_no_code() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    env.ledger().set_sequence_number(100);
    client
        .initiate_policy(
            &holder,
            &PolicyType::Health,
            &RegionTier::Low,
            &AgeBand::Adult,
            &CoverageTier::Basic,
            &50u32,
            &1_000_000i128,
            &token,
            &opts_no_code(),
        )
        .unwrap();
}

// ── initiate_policy with non-empty registry ───────────────────────────────────

#[test]
fn initiate_policy_succeeds_with_valid_active_region() {
    let (env, client, _admin, token) = setup();
    let code = String::from_str(&env, "EU-DE");
    client.admin_set_region(&code, &active_config(&env));
    let holder = Address::generate(&env);
    env.ledger().set_sequence_number(100);
    client
        .initiate_policy(
            &holder,
            &PolicyType::Health,
            &RegionTier::Low,
            &AgeBand::Adult,
            &CoverageTier::Basic,
            &50u32,
            &1_000_000i128,
            &token,
            &opts_with_code(&env, "EU-DE"),
        )
        .unwrap();
}

#[test]
fn initiate_policy_reverts_with_unknown_region_code() {
    let (env, client, _admin, token) = setup();
    let code = String::from_str(&env, "EU-DE");
    client.admin_set_region(&code, &active_config(&env));
    let holder = Address::generate(&env);
    env.ledger().set_sequence_number(100);
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Health,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Basic,
        &50u32,
        &1_000_000i128,
        &token,
        &opts_with_code(&env, "XX-UNKNOWN"),
    );
    assert!(result.is_err());
}

#[test]
fn initiate_policy_reverts_with_no_code_when_registry_non_empty() {
    let (env, client, _admin, token) = setup();
    let code = String::from_str(&env, "EU-DE");
    client.admin_set_region(&code, &active_config(&env));
    let holder = Address::generate(&env);
    env.ledger().set_sequence_number(100);
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Health,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Basic,
        &50u32,
        &1_000_000i128,
        &token,
        &opts_no_code(),
    );
    assert!(result.is_err());
}

#[test]
fn initiate_policy_reverts_for_deactivated_region() {
    let (env, client, _admin, token) = setup();
    let code = String::from_str(&env, "EU-DE");
    // First activate, then deactivate
    client.admin_set_region(&code, &active_config(&env));
    client.admin_set_region(&code, &inactive_config(&env));
    let holder = Address::generate(&env);
    env.ledger().set_sequence_number(100);
    let result = client.try_initiate_policy(
        &holder,
        &PolicyType::Health,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Basic,
        &50u32,
        &1_000_000i128,
        &token,
        &opts_with_code(&env, "EU-DE"),
    );
    assert!(result.is_err());
}

#[test]
fn region_config_includes_parent_and_risk_multiplier() {
    let (env, client, _admin, _token) = setup();
    let code = String::from_str(&env, "US-CA-SF");
    let config = RegionConfig {
        parent: String::from_str(&env, "US-CA"),
        risk_multiplier: 12_500,
        active: true,
    };
    client.admin_set_region(&code, &config);
    let got = client.get_region_config(&code).unwrap();
    assert_eq!(got.risk_multiplier, 12_500);
    assert_eq!(got.parent, String::from_str(&env, "US-CA"));
}

#[test]
fn region_risk_multiplier_is_applied_to_premium() {
    let (env, client, _admin, token) = setup();
    let code = String::from_str(&env, "US-CA-SF");
    client.admin_set_region(
        &code,
        &RegionConfig {
            parent: String::from_str(&env, "US-CA"),
            risk_multiplier: 12_500,
            active: true,
        },
    );

    let holder = Address::generate(&env);
    env.ledger().set_sequence_number(100);
    let policy = client
        .initiate_policy(
            &holder,
            &PolicyType::Health,
            &RegionTier::Low,
            &AgeBand::Adult,
            &CoverageTier::Basic,
            &50u32,
            &1_000_000i128,
            &token,
            &opts_with_code(&env, "US-CA-SF"),
        )
        .unwrap();

    assert_eq!(policy.premium, 860_625);
}
