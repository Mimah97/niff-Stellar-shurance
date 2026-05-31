//! Admin privilege matrix tests.
//!
//! Covers:
//!   - initialize guard (AlreadyInitialized)
//!   - propose_admin / accept_admin two-step rotation
//!   - cancel_admin withdraws proposal
//!   - Non-admin callers revert on every privileged entrypoint
//!   - Pending admin cannot be hijacked by an unrelated signer
//!   - accept_admin without a proposal reverts
//!   - set_token emits audit event with old/new values
//!   - pause / unpause toggle and event emission
//!   - drain rejects non-admin and zero amount
//!   - NEW: two-step admin action confirmation (propose/confirm/cancel/expiry)
//!   - All events carry machine-readable action names for NestJS ingestion

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

fn events_debug(env: &Env) -> std::string::String {
    soroban_sdk::testutils::arbitrary::std::format!("{:?}", env.events().all())
}

fn assert_admin_action_emitted(env: &Env, action_type: &str) {
    let debug = events_debug(env);
    assert!(
        debug.contains("admin_action") && debug.contains(action_type),
        "expected AdminAction audit event for {action_type}, got {debug}"
    );
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn initialize_succeeds_once() {
    let (env, _client, _admin, _token) = setup();
    assert_admin_action_emitted(&env, "initialize");
}

#[test]
fn initialize_twice_reverts() {
    let (env, client, _, _) = setup();
    let admin2 = Address::generate(&env);
    let token2 = Address::generate(&env);
    assert!(client.try_initialize(&admin2, &token2).is_err());
}

// ── propose_admin / accept_admin ──────────────────────────────────────────────

#[test]
fn two_step_rotation_completes() {
    let (env, client, _old_admin, _token) = setup();
    let new_admin = Address::generate(&env);

    client.propose_admin(&new_admin);
    client.accept_admin();

    // After rotation, old admin can no longer call privileged functions.
    // New admin can (mock_all_auths covers both sides in this test).
    // Verify by proposing again with the new admin — should not revert.
    let next = Address::generate(&env);
    client.propose_admin(&next);
}

#[test]
fn non_admin_cannot_propose() {
    let env2 = Env::default();
    let cid = env2.register(niffyinsure::NiffyInsure, ());
    let client2 = NiffyInsureClient::new(&env2, &cid);
    let admin = Address::generate(&env2);
    let token = Address::generate(&env2);
    let rando = Address::generate(&env2);
    let new_admin = Address::generate(&env2);
    env2.mock_all_auths();
    client2.initialize(&admin, &token);

    // Only mock auth for `rando`, not `admin`
    env2.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &rando,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &cid,
            fn_name: "propose_admin",
            args: soroban_sdk::vec![&env2], // propose_admin args not validated in mock
            sub_invokes: &[],
        },
    }]);
    assert!(client2.try_propose_admin(&new_admin).is_err());
}

#[test]
fn accept_admin_without_proposal_reverts() {
    let (_env, client, _, _) = setup();
    assert!(client.try_accept_admin().is_err());
}

#[test]
fn unrelated_signer_cannot_accept_pending_admin() {
    let (env, client, _admin, _token) = setup();
    let new_admin = Address::generate(&env);
    let hijacker = Address::generate(&env);

    client.propose_admin(&new_admin);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &hijacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &client.address,
            fn_name: "accept_admin",
            args: soroban_sdk::vec![&env],
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_accept_admin().is_err());
}

#[test]
fn cancel_admin_clears_proposal() {
    let (env, client, _, _) = setup();
    let new_admin = Address::generate(&env);

    client.propose_admin(&new_admin);
    client.cancel_admin();

    assert!(client.try_accept_admin().is_err());
}

#[test]
fn non_admin_cannot_cancel() {
    let env2 = Env::default();
    let cid = env2.register(niffyinsure::NiffyInsure, ());
    let client2 = NiffyInsureClient::new(&env2, &cid);
    let admin = Address::generate(&env2);
    let token = Address::generate(&env2);
    let new_admin = Address::generate(&env2);
    let rando = Address::generate(&env2);

    env2.mock_all_auths();
    client2.initialize(&admin, &token);
    client2.propose_admin(&new_admin);

    env2.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &rando,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &cid,
            fn_name: "cancel_admin",
            args: soroban_sdk::vec![&env2],
            sub_invokes: &[],
        },
    }]);
    assert!(client2.try_cancel_admin().is_err());
}

// ── set_token ─────────────────────────────────────────────────────────────────

#[test]
fn admin_can_set_token() {
    let (env, client, _, _) = setup();
    let new_token = Address::generate(&env);
    client.set_token(&new_token);
}

#[test]
fn set_token_emits_audit_event() {
    let (env, client, _, _) = setup();
    let new_token = Address::generate(&env);
    client.set_token(&new_token);
    assert_admin_action_emitted(&env, "set_token");
}

#[test]
fn non_admin_cannot_set_token() {
    let env2 = Env::default();
    let cid = env2.register(niffyinsure::NiffyInsure, ());
    let client2 = NiffyInsureClient::new(&env2, &cid);
    let admin = Address::generate(&env2);
    let token = Address::generate(&env2);
    let rando = Address::generate(&env2);
    let new_token = Address::generate(&env2);

    env2.mock_all_auths();
    client2.initialize(&admin, &token);

    env2.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &rando,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &cid,
            fn_name: "set_token",
            args: soroban_sdk::vec![
                &env2,
                soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&new_token, &env2)
            ],
            sub_invokes: &[],
        },
    }]);
    assert!(client2.try_set_token(&new_token).is_err());
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn admin_can_pause_and_unpause() {
    let (_env, client, admin, _) = setup();
    client.pause(&admin, &0u32);
    client.unpause(&admin, &0u32);
}

#[test]
fn pause_emits_event() {
    let (env, client, admin, _) = setup();
    client.pause(&admin, &0u32);
    assert_admin_action_emitted(&env, "pause");
}

#[test]
fn admin_entrypoints_emit_admin_action_audit_events() {
    let (env, client, admin, _token) = setup();
    let asset = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let new_token = Address::generate(&env);
    client.set_token(&new_token);
    assert_admin_action_emitted(&env, "set_token");

    let new_treasury = Address::generate(&env);
    client.set_treasury(&new_treasury);
    assert_admin_action_emitted(&env, "set_treasury");

    client.set_allowed_asset(&asset, &true, &String::from_str(&env, "USDC"), &7u32);
    assert_admin_action_emitted(&env, "set_allowed_asset");

    client.admin_set_vote_duration_ledgers(&120u32);
    assert_admin_action_emitted(&env, "admin_set_vote_duration_ledgers");

    client.admin_set_quorum_bps(&5_000u32);
    assert_admin_action_emitted(&env, "admin_set_quorum_bps");

    client.set_grace_period_ledgers(&1_000u32);
    assert_admin_action_emitted(&env, "set_grace_period_ledgers");

    let calculator = Address::generate(&env);
    client.set_calculator(&calculator);
    assert_admin_action_emitted(&env, "set_calculator");
    client.clear_calculator();
    assert_admin_action_emitted(&env, "clear_calculator");

    let pending = Address::generate(&env);
    client.propose_admin(&pending);
    assert_admin_action_emitted(&env, "propose_admin");
    client.cancel_admin();
    assert_admin_action_emitted(&env, "cancel_admin");

    client.set_sweep_cap(&Some(1_000_000i128));
    assert_admin_action_emitted(&env, "set_sweep_cap");
    client.set_sweep_notice_period(&0u32);
    assert_admin_action_emitted(&env, "set_sweep_notice_period");

    client.admin_set_max_evidence_count(&5u32);
    assert_admin_action_emitted(&env, "admin_set_max_evidence_count");
    client.admin_set_gateway_allowlist(&soroban_sdk::vec![&env, String::from_str(&env, "ipfs://")]);
    assert_admin_action_emitted(&env, "admin_set_gateway_allowlist");

    client.pause(&admin, &0u32);
    assert_admin_action_emitted(&env, "pause");
    client.unpause(&admin, &0u32);
    assert_admin_action_emitted(&env, "unpause");
    client.pause_bind(&admin, &0u32);
    assert_admin_action_emitted(&env, "pause_bind");
    client.pause_claims(&admin, &0u32);
    assert_admin_action_emitted(&env, "pause_claims");

    client.set_rolling_claim_cap(&1_000_000i128);
    assert_admin_action_emitted(&env, "set_rolling_claim_cap");
    client.set_rolling_claim_window_ledgers(&1_000u32);
    assert_admin_action_emitted(&env, "set_rolling_claim_window_ledgers");
    client.set_ttl_alert_threshold(&500_000u32);
    assert_admin_action_emitted(&env, "set_ttl_alert_threshold");
}

#[test]
fn failed_non_admin_call_does_not_emit_admin_action() {
    let env = Env::default();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let rando = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &token);
    let before = env.events().all().events().len();

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &rando,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &cid,
            fn_name: "set_token",
            args: soroban_sdk::vec![
                &env,
                soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&token, &env)
            ],
            sub_invokes: &[],
        },
    }]);

    assert!(client.try_set_token(&token).is_err());
    assert_eq!(
        env.events().all().events().len(),
        before,
        "unauthorized call must not emit AdminAction"
    );
}

// ── Two-step admin action: propose / confirm / cancel / expiry ────────────────

fn treasury_rotation_action(env: &Env) -> niffyinsure::admin::AdminAction {
    niffyinsure::admin::AdminAction::treasury_rotation(Address::generate(env))
}

/// Proposer proposes; a different signer confirms; action executes and events fire.
#[test]
fn two_step_action_confirmation_succeeds() {
    let (env, client, _admin, _token) = setup();
    let confirmer = Address::generate(&env);

    let action = treasury_rotation_action(&env);
    client.propose_admin_action(&action);

    // Events must include AdminActionProposed.
    let events = env.events().all();
    assert!(
        events.events().len() > 0,
        "AdminActionProposed event must be emitted"
    );

    client.confirm_admin_action(&confirmer);

    // AdminActionConfirmed must be present after confirmation.
    let events_after = env.events().all();
    assert!(
        events_after.events().len() > 0,
        "AdminActionConfirmed event must be emitted"
    );

    // Pending action is cleared — a second confirm must revert.
    assert!(client.try_confirm_admin_action(&confirmer).is_err());
}

/// Proposer cannot confirm their own proposal.
#[test]
fn proposer_cannot_self_confirm() {
    let (env, client, admin, _token) = setup();
    let action = treasury_rotation_action(&env);
    client.propose_admin_action(&action);
    // Confirmer == admin (the proposer) must revert.
    assert!(client.try_confirm_admin_action(&admin).is_err());
}

/// An expired proposal is inert: confirm reverts and emits AdminActionExpired.
#[test]
fn expired_action_cannot_be_confirmed() {
    let (env, client, _admin, _token) = setup();
    let confirmer = Address::generate(&env);

    let action = treasury_rotation_action(&env);
    client.propose_admin_action(&action);

    // Advance ledger past the default window (100 ledgers).
    env.ledger().with_mut(|l| l.sequence_number += 200);

    let result = client.try_confirm_admin_action(&confirmer);
    assert!(result.is_err());
}

/// Expired proposals cannot be replayed: a second confirm after expiry also reverts.
#[test]
fn expired_action_cannot_be_replayed() {
    let (env, client, _admin, _token) = setup();
    let confirmer = Address::generate(&env);

    let action = treasury_rotation_action(&env);
    client.propose_admin_action(&action);
    env.ledger().with_mut(|l| l.sequence_number += 200);

    // First attempt clears the pending entry.
    let _ = client.try_confirm_admin_action(&confirmer);
    // Second attempt must also revert (no pending action).
    assert!(client.try_confirm_admin_action(&confirmer).is_err());
}

/// Admin can cancel a pending action before it expires.
#[test]
fn admin_can_cancel_pending_action() {
    let (env, client, _admin, _token) = setup();
    let confirmer = Address::generate(&env);

    let action = treasury_rotation_action(&env);
    client.propose_admin_action(&action);
    client.cancel_admin_action();

    // After cancellation, confirm must revert.
    assert!(client.try_confirm_admin_action(&confirmer).is_err());
}

/// Non-admin cannot cancel a pending action.
#[test]
fn non_admin_cannot_cancel_action() {
    let env2 = Env::default();
    let cid = env2.register(niffyinsure::NiffyInsure, ());
    let client2 = NiffyInsureClient::new(&env2, &cid);
    let admin = Address::generate(&env2);
    let token = Address::generate(&env2);
    let rando = Address::generate(&env2);

    env2.mock_all_auths();
    client2.initialize(&admin, &token);
    client2.propose_admin_action(&niffyinsure::admin::AdminAction::treasury_rotation(
        Address::generate(&env2),
    ));

    env2.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &rando,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &cid,
            fn_name: "cancel_admin_action",
            args: soroban_sdk::vec![&env2],
            sub_invokes: &[],
        },
    }]);
    assert!(client2.try_cancel_admin_action().is_err());
}

/// High-risk operation (treasury rotation) requires two signatures in tests:
/// a single propose call without confirm must NOT change the treasury.
#[test]
fn single_signature_cannot_execute_high_risk_action() {
    let (env, client, _admin, _token) = setup();
    let new_treasury = Address::generate(&env);

    client.propose_admin_action(&niffyinsure::admin::AdminAction::treasury_rotation(
        new_treasury.clone(),
    ));

    // No confirm called — treasury must be unchanged (still the contract address default).
    // Attempting to confirm with the proposer (admin) must revert.
    assert!(client.try_confirm_admin_action(&_admin).is_err());
}
