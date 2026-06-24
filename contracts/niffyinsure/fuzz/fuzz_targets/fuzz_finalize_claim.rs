#![no_main]

use libfuzzer_sys::fuzz_target;
use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier, VoteOption},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env, String,
};

const STARTING_BALANCE: i128 = 10_000_000_000;
const INITIAL_LEDGER: u32 = 400;

// Minimum byte budget: 8 (claim_id) = 8.
const MIN_DATA: usize = 8;

/// Build a contract with one filed claim (id=1) in Processing state and return its id.
fn setup_with_filed_claim(env: &Env) -> (NiffyInsureClient<'_>, u64) {
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = INITIAL_LEDGER);

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token_addr);

    let holder = Address::generate(env);
    token::StellarAssetClient::new(env, &token_addr).mint(&holder, &STARTING_BALANCE);
    token::Client::new(env, &token_addr).approve(
        &holder,
        &client.address,
        &STARTING_BALANCE,
        &(INITIAL_LEDGER + 10_000),
    );

    // Seed two voters so quorum is possible.
    let voter1 = Address::generate(env);
    let voter2 = Address::generate(env);
    client.test_seed_policy(&voter1, &1u32, &1_000_000i128, &10_000u32);
    client.test_seed_policy(&voter2, &1u32, &1_000_000i128, &10_000u32);

    // Create a policy.
    let _ = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Basic,
        &50u32,
        &1_000_000i128,
        &token_addr,
        &InitiatePolicyOptions::test_defaults(env),
    );

    // Fund contract for potential payout.
    token::StellarAssetClient::new(env, &token_addr).mint(&client.address, &500_000_000i128);

    // File a claim.
    let details = String::from_str(env, "fuzz finalize claim");
    let evidence = vec![env];
    let claim_id = match client.try_file_claim(&holder, &1u32, &100_000i128, &details, &evidence, &None) {
        Ok(Ok(id)) => id,
        _ => 1,
    };

    // Cast some votes to move the claim toward a terminal state.
    let _ = client.try_vote_on_claim(&voter1, &claim_id, &VoteOption::Approve);
    let _ = client.try_vote_on_claim(&voter2, &claim_id, &VoteOption::Approve);

    (client, claim_id)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < MIN_DATA {
        return;
    }

    let env = Env::default();
    let (client, _real_claim_id) = setup_with_filed_claim(&env);

    // Use 8 fuzz bytes as a claim_id to probe the full u64 space (including
    // missing claims, already-finalized claims, and the real claim id).
    let fuzz_claim_id = u64::from_le_bytes(data[0..8].try_into().unwrap_or([0; 8]));

    // Call the entrypoint.  Errors are expected and ignored; panics are crashes.
    let _ = client.try_finalize_claim(&fuzz_claim_id);
});
