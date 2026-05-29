//! Tests for per-asset premium table (coverage-amount-to-premium mapping per token).
//!
//! Covers:
//! - Asset-specific table returns correct (different) premium values.
//! - Fallback to global default when no asset-specific table is set.
//! - Non-allowlisted asset reverts when setting a table.
//! - Clearing an asset-specific table reverts to global default.
//! - initiate_policy uses the asset-specific table for premium calculation.
//! - generate_premium_for_asset uses the asset-specific table.

#![cfg(test)]

use niffyinsure::types::{
    AgeBand, CoverageTier, MultiplierTable, PolicyType, RegionTier, RiskInput,
};
use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, token, Address, Env, Map};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct TestEnv<'a> {
    env: Env,
    client: NiffyInsureClient<'a>,
    contract_id: Address,
    default_token: Address,
    default_token_admin: token::StellarAssetClient<'a>,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let default_token = env
        .register_stellar_asset_contract_v2(issuer)
        .address();
    let default_token_admin = token::StellarAssetClient::new(&env, &default_token);

    client.initialize(&admin, &default_token);

    TestEnv {
        env,
        client,
        contract_id,
        default_token,
        default_token_admin,
    }
}

fn make_asset<'a>(t: &'a TestEnv<'a>) -> (Address, token::StellarAssetClient<'a>) {
    let issuer = Address::generate(&t.env);
    let addr = t.env.register_stellar_asset_contract_v2(issuer).address();
    let admin_client = token::StellarAssetClient::new(&t.env, &addr);
    (addr, admin_client)
}

/// Build a complete MultiplierTable with all required entries.
/// `region_low_multiplier` lets tests set a distinctive value to verify routing.
fn make_table(env: &Env, region_low_multiplier: i128, version: u32) -> MultiplierTable {
    let mut region = Map::new(env);
    region.set(RegionTier::Low, region_low_multiplier);
    region.set(RegionTier::Medium, 10_000i128);
    region.set(RegionTier::High, 13_500i128);

    let mut age = Map::new(env);
    age.set(AgeBand::Young, 12_500i128);
    age.set(AgeBand::Adult, 10_000i128);
    age.set(AgeBand::Senior, 11_500i128);

    let mut coverage = Map::new(env);
    coverage.set(CoverageTier::Basic, 9_000i128);
    coverage.set(CoverageTier::Standard, 10_000i128);
    coverage.set(CoverageTier::Premium, 13_000i128);

    MultiplierTable {
        region,
        age,
        coverage,
        safety_discount: 2_000,
        version,
    }
}

fn default_input() -> RiskInput {
    RiskInput {
        region: RegionTier::Low,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score: 0,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// When an asset-specific table is set, `generate_premium_for_asset` returns a
/// premium computed from that table, not the global default.
#[test]
fn asset_specific_table_returns_different_premium() {
    let t = setup();
    let (token_b, _) = make_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let input = default_input();
    let base = 10_000_000i128;

    // Premium with global default (region Low = 8_500).
    let default_quote = t.client.generate_premium_for_asset(&input, &base, &false, &t.default_token);

    // Set an asset-specific table for token_b with a higher Low multiplier (20_000 = 2×).
    let asset_table = make_table(&t.env, 20_000, 1);
    t.client.admin_set_asset_premium_table(&token_b, &Some(asset_table)).unwrap();

    let asset_quote = t.client.generate_premium_for_asset(&input, &base, &false, &token_b);

    assert!(
        asset_quote.total_premium > default_quote.total_premium,
        "asset-specific table (higher multiplier) should produce a higher premium: \
         asset={}, default={}",
        asset_quote.total_premium,
        default_quote.total_premium
    );
}

/// When no asset-specific table is set, `generate_premium_for_asset` falls back
/// to the global default table and returns the same result as `generate_premium`.
#[test]
fn fallback_to_default_when_no_asset_table() {
    let t = setup();
    let (token_b, _) = make_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    // No asset-specific table set for token_b.
    assert!(t.client.get_asset_premium_table(&token_b).is_none());

    let input = default_input();
    let base = 10_000_000i128;

    let default_quote = t.client.generate_premium(&input, &base, &false);
    let fallback_quote = t.client.generate_premium_for_asset(&input, &base, &false, &token_b);

    assert_eq!(
        default_quote.total_premium,
        fallback_quote.total_premium,
        "fallback must produce the same premium as the global default"
    );
}

/// Setting an asset-specific table for a non-allowlisted asset must revert.
#[test]
fn set_table_reverts_for_non_allowlisted_asset() {
    let t = setup();
    let (non_listed, _) = make_asset(&t);
    // non_listed is NOT allowlisted.

    let table = make_table(&t.env, 10_000, 1);
    let result = t.client.try_admin_set_asset_premium_table(&non_listed, &Some(table));

    assert!(
        result.is_err(),
        "expected revert when asset is not allowlisted"
    );
    assert!(t.client.get_asset_premium_table(&non_listed).is_none());
}

/// Clearing an asset-specific table (passing None) reverts to the global default.
#[test]
fn clearing_asset_table_reverts_to_default() {
    let t = setup();
    let (token_b, _) = make_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    // Set a distinctive table.
    let asset_table = make_table(&t.env, 20_000, 1);
    t.client.admin_set_asset_premium_table(&token_b, &Some(asset_table)).unwrap();
    assert!(t.client.get_asset_premium_table(&token_b).is_some());

    // Clear it.
    t.client.admin_set_asset_premium_table(&token_b, &None).unwrap();
    assert!(t.client.get_asset_premium_table(&token_b).is_none());

    // Premium should now match the global default.
    let input = default_input();
    let base = 10_000_000i128;
    let default_quote = t.client.generate_premium(&input, &base, &false);
    let after_clear = t.client.generate_premium_for_asset(&input, &base, &false, &token_b);
    assert_eq!(default_quote.total_premium, after_clear.total_premium);
}

/// `initiate_policy` uses the asset-specific table when one is configured,
/// resulting in a different (higher) premium than the global default.
#[test]
fn initiate_policy_uses_asset_specific_table() {
    let t = setup();
    let (token_b, token_b_admin) = make_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let base = 1_000_000_000i128;
    let input = default_input();

    // Premium with global default for token_b (no asset table yet).
    let default_quote = t.client.generate_premium_for_asset(&input, &base, &false, &token_b);

    // Set a higher-multiplier table for token_b.
    let asset_table = make_table(&t.env, 20_000, 1); // Low = 2× vs default 0.85×
    t.client.admin_set_asset_premium_table(&token_b, &Some(asset_table)).unwrap();

    let asset_quote = t.client.generate_premium_for_asset(&input, &base, &false, &token_b);
    assert!(asset_quote.total_premium > default_quote.total_premium);

    // Fund holder with enough token_b to cover the higher premium.
    let holder = Address::generate(&t.env);
    token_b_admin.mint(&holder, &(asset_quote.total_premium * 2));
    token::Client::new(&t.env, &token_b).approve(
        &holder,
        &t.client.address,
        &(asset_quote.total_premium * 2),
        &(t.env.ledger().sequence() + 10_000),
    );

    let policy = t.client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &0u32,
        &base,
        &token_b,
        &niffyinsure::types::InitiatePolicyOptions {
            beneficiary: None,
            deductible: None,
            expected_nonce: None,
        },
    );

    // The stored premium must match the asset-specific quote.
    assert_eq!(
        policy.premium,
        asset_quote.total_premium,
        "policy premium must use the asset-specific table"
    );
    assert!(
        policy.premium > default_quote.total_premium,
        "asset-specific premium must be higher than the default"
    );
}

/// Two assets with different tables produce independent premiums; changing one
/// does not affect the other.
#[test]
fn two_assets_have_independent_tables() {
    let t = setup();
    let (token_b, _) = make_asset(&t);
    let (token_c, _) = make_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);
    t.client.set_allowed_asset(&token_c, &true);

    let table_b = make_table(&t.env, 20_000, 1); // high multiplier
    let table_c = make_table(&t.env, 6_000, 1);  // low multiplier

    t.client.admin_set_asset_premium_table(&token_b, &Some(table_b)).unwrap();
    t.client.admin_set_asset_premium_table(&token_c, &Some(table_c)).unwrap();

    let input = default_input();
    let base = 10_000_000i128;

    let quote_b = t.client.generate_premium_for_asset(&input, &base, &false, &token_b);
    let quote_c = t.client.generate_premium_for_asset(&input, &base, &false, &token_c);

    assert!(
        quote_b.total_premium > quote_c.total_premium,
        "token_b (higher multiplier) must cost more than token_c"
    );

    // Clearing token_b's table does not affect token_c.
    t.client.admin_set_asset_premium_table(&token_b, &None).unwrap();
    let quote_c_after = t.client.generate_premium_for_asset(&input, &base, &false, &token_c);
    assert_eq!(
        quote_c.total_premium,
        quote_c_after.total_premium,
        "token_c premium must be unchanged after clearing token_b table"
    );
}

/// Version must be strictly increasing for asset-specific tables.
#[test]
fn asset_table_version_must_increase() {
    let t = setup();
    let (token_b, _) = make_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let table_v1 = make_table(&t.env, 10_000, 1);
    t.client.admin_set_asset_premium_table(&token_b, &Some(table_v1)).unwrap();

    // Same version should fail.
    let table_v1_again = make_table(&t.env, 11_000, 1);
    let result = t.client.try_admin_set_asset_premium_table(&token_b, &Some(table_v1_again));
    assert!(result.is_err(), "same version must be rejected");

    // Lower version should fail.
    let table_v0 = make_table(&t.env, 11_000, 0);
    let result = t.client.try_admin_set_asset_premium_table(&token_b, &Some(table_v0));
    assert!(result.is_err(), "lower version must be rejected");

    // Higher version should succeed.
    let table_v2 = make_table(&t.env, 11_000, 2);
    t.client.admin_set_asset_premium_table(&token_b, &Some(table_v2)).unwrap();
    let stored = t.client.get_asset_premium_table(&token_b).unwrap();
    assert_eq!(stored.version, 2);
}
