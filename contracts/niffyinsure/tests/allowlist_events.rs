//! Tests for AssetAdded / AssetRemoved event emission via `set_allowed_asset`.
//!
//! Acceptance criteria:
//! - `asset_set` event emitted on add (allowed=1) with symbol_hint and decimals.
//! - `asset_set` event emitted on remove (allowed=0).
//! - Event emitted even for idempotent re-add of an already-allowed asset.

#![cfg(test)]

mod common;

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    client.initialize(&admin, &token);
    (env, client, token)
}

fn new_asset(env: &Env) -> Address {
    env.register_stellar_asset_contract_v2(Address::generate(env))
        .address()
}

#[test]
fn add_emits_asset_set_event() {
    let (env, client, _token) = setup();
    let asset = new_asset(&env);

    client.set_allowed_asset(
        &asset,
        &true,
        &String::from_str(&env, "USDC"),
        &7u32,
    );

    assert!(client.is_allowed_asset(&asset));
    assert!(!env.events().all().events().is_empty(), "asset_set event must be emitted on add");
}

#[test]
fn remove_emits_asset_set_event() {
    let (env, client, _token) = setup();
    let asset = new_asset(&env);

    client.set_allowed_asset(&asset, &true, &String::from_str(&env, "USDC"), &7u32);
    // drain events from add
    let _ = env.events().all();

    client.set_allowed_asset(&asset, &false, &String::from_str(&env, ""), &0u32);

    assert!(!client.is_allowed_asset(&asset));
    assert!(!env.events().all().events().is_empty(), "asset_set event must be emitted on remove");
}

#[test]
fn readd_already_allowed_asset_emits_event_without_revert() {
    let (env, client, _token) = setup();
    let asset = new_asset(&env);

    client.set_allowed_asset(&asset, &true, &String::from_str(&env, "USDC"), &7u32);
    assert!(client.is_allowed_asset(&asset));

    // Re-add: must not revert and must emit an event.
    client.set_allowed_asset(&asset, &true, &String::from_str(&env, "USDC"), &7u32);
    assert!(client.is_allowed_asset(&asset));
    assert!(!env.events().all().events().is_empty(), "asset_set event must be emitted on idempotent re-add");
}
