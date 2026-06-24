#![no_main]

use libfuzzer_sys::fuzz_target;
use niffyinsure::{
    types::{AgeBand, CoverageTier, InitiatePolicyOptions, PolicyType, RegionTier},
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

// Minimum byte budget: 1 (policy_type) + 1 (region) + 1 (age_band) +
//                      1 (coverage_type) + 4 (safety_score) + 16 (base_amount) = 24.
const MIN_DATA: usize = 24;
const STARTING_BALANCE: i128 = 10_000_000_000;
const INITIAL_LEDGER: u32 = 400;

fn pick_policy_type(b: u8) -> PolicyType {
    match b % 3 {
        0 => PolicyType::Auto,
        1 => PolicyType::Health,
        _ => PolicyType::Property,
    }
}

fn pick_region(b: u8) -> RegionTier {
    match b % 3 {
        0 => RegionTier::Low,
        1 => RegionTier::Medium,
        _ => RegionTier::High,
    }
}

fn pick_age_band(b: u8) -> AgeBand {
    match b % 3 {
        0 => AgeBand::Young,
        1 => AgeBand::Adult,
        _ => AgeBand::Senior,
    }
}

fn pick_coverage_tier(b: u8) -> CoverageTier {
    match b % 3 {
        0 => CoverageTier::Basic,
        1 => CoverageTier::Standard,
        _ => CoverageTier::Premium,
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
    token::StellarAssetClient::new(&env, &token_addr).mint(&holder, &STARTING_BALANCE);
    token::Client::new(&env, &token_addr).approve(
        &holder,
        &client.address,
        &STARTING_BALANCE,
        &(INITIAL_LEDGER + 10_000),
    );

    // Parse fuzz inputs.
    let policy_type = pick_policy_type(data[0]);
    let region = pick_region(data[1]);
    let age_band = pick_age_band(data[2]);
    let coverage_type = pick_coverage_tier(data[3]);
    let safety_score = u32::from_le_bytes(data[4..8].try_into().unwrap_or([0; 4]));
    let base_amount = i128::from_le_bytes(data[8..24].try_into().unwrap_or([0; 16]));

    // Optional metadata URI from trailing bytes (non-empty string required by contract).
    let metadata_uri = if data.len() > 24 {
        let s = &data[24..data.len().min(24 + 256)];
        let raw = core::str::from_utf8(s).unwrap_or("ipfs://fuzz");
        let trimmed = if raw.is_empty() { "ipfs://fuzz" } else { raw };
        String::from_str(&env, trimmed)
    } else {
        String::from_str(&env, "ipfs://fuzz")
    };

    let opts = InitiatePolicyOptions {
        beneficiary: None,
        deductible: None,
        expected_nonce: None,
        metadata_uri,
        region_code: None,
    };

    // Call the entrypoint.  Errors are expected and ignored; panics are crashes.
    let _ = client.try_initiate_policy(
        &holder,
        &policy_type,
        &region,
        &age_band,
        &coverage_type,
        &safety_score,
        &base_amount,
        &token_addr,
        &opts,
    );
});
