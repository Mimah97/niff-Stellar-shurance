#![no_main]

use libfuzzer_sys::fuzz_target;
use niffyinsure::{
    types::{
        AgeBand, ClaimEvidenceEntry, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier,
    },
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, BytesN, Env, String, Vec,
};

// Minimum byte budget: 4 (policy_id) + 16 (amount) = 20.
const MIN_DATA: usize = 20;
const STARTING_BALANCE: i128 = 10_000_000_000;
const INITIAL_LEDGER: u32 = 400;

fn build_evidence(env: &Env, flag: u8) -> Vec<ClaimEvidenceEntry> {
    if flag & 1 == 0 {
        vec![env]
    } else {
        let hash_bytes = [flag; 32];
        let entry = ClaimEvidenceEntry {
            url: String::from_str(env, "ipfs://fuzz"),
            hash: BytesN::from_array(env, &hash_bytes),
        };
        vec![env, entry]
    }
}

fuzz_target!(|data: &[u8]| {
    if data.len() < MIN_DATA {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = INITIAL_LEDGER);

    // Register and initialise the contract.
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token_addr);

    let holder = Address::generate(&env);
    // Mint and approve so the premium transfer can proceed.
    token::StellarAssetClient::new(&env, &token_addr).mint(&holder, &STARTING_BALANCE);
    token::Client::new(&env, &token_addr).approve(
        &holder,
        &client.address,
        &STARTING_BALANCE,
        &(INITIAL_LEDGER + 10_000),
    );

    // Seed a voter so quorum > 0 is possible.
    let voter = Address::generate(&env);
    client.test_seed_policy(&voter, &1u32, &1_000_000i128, &10_000u32);

    // Create a minimal valid policy so file_claim has something to file against.
    let _ = client.try_initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Basic,
        &50u32,
        &1_000_000i128,
        &token_addr,
        &InitiatePolicyOptions::test_defaults(&env),
    );

    // Parse fuzz inputs.
    let policy_id = u32::from_le_bytes(data[0..4].try_into().unwrap_or([0; 4]));
    let amount = i128::from_le_bytes(data[4..20].try_into().unwrap_or([0; 16]));
    let evidence_flag = *data.get(20).unwrap_or(&0);
    let details = if data.len() > 21 {
        // Interpret remaining bytes as a string, clamped to 256 chars.
        let s = &data[21..data.len().min(21 + 256)];
        String::from_str(&env, core::str::from_utf8(s).unwrap_or("fuzz"))
    } else {
        String::from_str(&env, "fuzz")
    };

    let evidence = build_evidence(&env, evidence_flag);

    // Call the entrypoint.  Errors are expected and ignored; panics are crashes.
    let _ = client.try_file_claim(&holder, &policy_id, &amount, &details, &evidence, &None);
});
