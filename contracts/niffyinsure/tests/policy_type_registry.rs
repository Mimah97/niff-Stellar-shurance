//! #582 — Policy type registry: admin-managed coverage product catalog.
//!
//! Acceptance criteria:
//! - Unregistered policy types revert at initiation.
//! - Existing policies of a deregistered type remain valid.
//! - Registry changes are authenticated and emit events.

#![cfg(test)]

use niffyinsure::{
    types::{AgeBand, CoverageType, InitiatePolicyOptions, PolicyType, PolicyTypeConfig, RegionTier},
    NiffyInsureClient, PolicyError,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let tok = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &tok);
    (env, client, admin, tok)
}

fn mint_and_approve(env: &Env, client: &NiffyInsureClient, holder: &Address, token: &Address) {
    token::StellarAssetClient::new(env, token).mint(holder, &10_000_000_000i128);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &10_000_000_000i128,
        &6_312_000u32,
    );
}

fn initiate(
    client: &NiffyInsureClient,
    holder: &Address,
    policy_type: &PolicyType,
    token: &Address,
) -> Result<niffyinsure::types::Policy, niffyinsure::PolicyError> {
    match client.try_initiate_policy(
        holder,
        policy_type,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80u32,
        &1_000_000i128,
        token,
        &InitiatePolicyOptions {
            beneficiary: None,
            deductible: None,
            expected_nonce: None,
        },
    ) {
        Ok(Ok(policy)) => Ok(policy),
        Err(Ok(e)) => Err(e),
        Ok(Err(e)) => panic!("conversion error: {e:?}"),
        Err(Err(e)) => panic!("invoke error: {e:?}"),
    }
}

// ── Before registry is enabled, all types are allowed ────────────────────────

#[test]
fn all_types_allowed_before_registry_enabled() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    mint_and_approve(&env, &client, &holder, &token);

    // No registry configured — all types should pass.
    assert!(initiate(&client, &holder, &PolicyType::Auto, &token).is_ok());
}

// ── Registered type is allowed ────────────────────────────────────────────────

#[test]
fn registered_type_is_allowed() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    mint_and_approve(&env, &client, &holder, &token);

    client.admin_register_policy_type(
        &PolicyType::Auto,
        &PolicyTypeConfig {
            payout_asset_override: None,
        },
    );

    assert!(initiate(&client, &holder, &PolicyType::Auto, &token).is_ok());
}

// ── Unregistered type reverts after registry is enabled ──────────────────────

#[test]
fn unregistered_type_reverts_after_registry_enabled() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    mint_and_approve(&env, &client, &holder, &token);

    // Register only Auto — Health is unregistered.
    client.admin_register_policy_type(
        &PolicyType::Auto,
        &PolicyTypeConfig {
            payout_asset_override: None,
        },
    );

    let err = initiate(&client, &holder, &PolicyType::Health, &token)
        .err()
        .unwrap();
    // AssetNotAllowed is the error returned for registry rejection.
    assert_eq!(err, PolicyError::AssetNotAllowed);
}

// ── Deregistered type reverts at initiation ───────────────────────────────────

#[test]
fn deregistered_type_reverts_at_initiation() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    mint_and_approve(&env, &client, &holder, &token);

    client.admin_register_policy_type(
        &PolicyType::Auto,
        &PolicyTypeConfig {
            payout_asset_override: None,
        },
    );
    client.admin_deregister_policy_type(&PolicyType::Auto);

    let err = initiate(&client, &holder, &PolicyType::Auto, &token)
        .err()
        .unwrap();
    assert_eq!(err, PolicyError::AssetNotAllowed);
}

// ── Existing policies of a deregistered type remain valid ────────────────────

#[test]
fn existing_policies_of_deregistered_type_remain_valid() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    mint_and_approve(&env, &client, &holder, &token);

    // Register Auto and create a policy.
    client.admin_register_policy_type(
        &PolicyType::Auto,
        &PolicyTypeConfig {
            payout_asset_override: None,
        },
    );
    let policy = initiate(&client, &holder, &PolicyType::Auto, &token).unwrap();

    // Deregister Auto.
    client.admin_deregister_policy_type(&PolicyType::Auto);

    // Existing policy should still be readable and active.
    let stored = client.get_policy(&holder, &policy.policy_id).unwrap();
    assert!(stored.is_active);
    assert_eq!(stored.policy_type, PolicyType::Auto);
}

// ── is_policy_type_active reflects registry state ────────────────────────────

#[test]
fn is_policy_type_active_reflects_registry() {
    let (env, client, _, _) = setup();

    assert!(!client.is_policy_type_active(&PolicyType::Auto));

    client.admin_register_policy_type(
        &PolicyType::Auto,
        &PolicyTypeConfig {
            payout_asset_override: None,
        },
    );
    assert!(client.is_policy_type_active(&PolicyType::Auto));

    client.admin_deregister_policy_type(&PolicyType::Auto);
    assert!(!client.is_policy_type_active(&PolicyType::Auto));
}

// ── get_policy_type_config returns stored config ──────────────────────────────

#[test]
fn get_policy_type_config_returns_stored_config() {
    let (env, client, _, _) = setup();

    assert!(client.get_policy_type_config(&PolicyType::Health).is_none());

    let config = PolicyTypeConfig {
        payout_asset_override: None,
    };
    client.admin_register_policy_type(&PolicyType::Health, &config);

    let stored = client.get_policy_type_config(&PolicyType::Health).unwrap();
    assert_eq!(stored.payout_asset_override, None);
}

// ── Re-registering a deregistered type re-enables it ─────────────────────────

#[test]
fn re_registering_deregistered_type_re_enables_it() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    mint_and_approve(&env, &client, &holder, &token);

    client.admin_register_policy_type(
        &PolicyType::Property,
        &PolicyTypeConfig {
            payout_asset_override: None,
        },
    );
    client.admin_deregister_policy_type(&PolicyType::Property);

    // Re-register.
    client.admin_register_policy_type(
        &PolicyType::Property,
        &PolicyTypeConfig {
            payout_asset_override: None,
        },
    );

    assert!(initiate(&client, &holder, &PolicyType::Property, &token).is_ok());
}
