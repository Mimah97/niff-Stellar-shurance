//! Treasury deposit allowlist tests.
//!
//! Covers:
//! - Admin-managed depositor allowlist
//! - Authorized capital injection succeeds and emits an event
//! - Unauthorized depositor is rejected
//! - Zero-amount deposits revert

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, Address, Env,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    (env, client, admin, token, cid)
}

#[test]
fn authorized_treasury_deposit_succeeds_and_emits_event() {
    let (env, client, _admin, token, contract_id) = setup();
    let depositor = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    client.set_authorized_depositor(&depositor, &true).unwrap();
    token_admin.mint(&depositor, &1_000_000i128);

    let before_events = env.events().all().events().len();
    let before_depositor_balance = token::Client::new(&env, &token).balance(&depositor);
    let before_treasury_balance = token::Client::new(&env, &token).balance(&contract_id);

    client.deposit_treasury(&depositor, &500_000i128, &token).unwrap();

    assert_eq!(
        token::Client::new(&env, &token).balance(&depositor),
        before_depositor_balance - 500_000i128,
    );
    assert_eq!(
        token::Client::new(&env, &token).balance(&contract_id),
        before_treasury_balance + 500_000i128,
    );
    assert!(env.events().all().events().len() > before_events);
    assert!(client.is_authorized_depositor(&depositor));
}

#[test]
fn unauthorized_depositor_cannot_call_deposit_entrypoint() {
    let (env, client, _admin, token, _contract_id) = setup();
    let allowed = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    client.set_authorized_depositor(&allowed, &true).unwrap();
    token_admin.mint(&unauthorized, &1_000_000i128);

    let result = client.try_deposit_treasury(&unauthorized, &500_000i128, &token);
    assert!(result.is_err());
    assert!(format!("{:?}", result).contains("UnauthorizedTreasuryDepositor"));
}

#[test]
fn zero_amount_deposit_reverts() {
    let (env, client, _admin, token, _contract_id) = setup();
    let depositor = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &token);

    client.set_authorized_depositor(&depositor, &true).unwrap();
    token_admin.mint(&depositor, &1_000_000i128);

    let result = client.try_deposit_treasury(&depositor, &0i128, &token);
    assert!(result.is_err());
    assert!(format!("{:?}", result).contains("ZeroTreasuryDeposit"));
}
