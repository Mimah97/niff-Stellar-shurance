//! Cross-contract client for the external PremiumCalculator contract.
//!
//! When a calculator address is configured the policy contract delegates all
//! premium computation to it.  If the calculator is paused or the call fails
//! the error is propagated faithfully — bind fails closed.
//!
//! When no calculator address is stored the contract falls back to the
//! built-in `premium::compute_premium` logic so existing deployments keep
//! working without migration.

use soroban_sdk::{contractclient, Address, Env};

use crate::{
    premium, storage,
    types::{AgeBand, CoverageTier, PremiumQuote, RegionTier, RiskInput},
    validate::Error,
};

// ── Mirrored types from premium_calculator ────────────────────────────────────
// These must stay structurally identical to `premium_calculator::types`.

use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CalcRegionTier {
    Low,
    Medium,
    High,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CalcAgeBand {
    Young,
    Adult,
    Senior,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CalcCoverageType {
    Basic,
    Standard,
    Premium,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalcInput {
    pub region: CalcRegionTier,
    pub age_band: CalcAgeBand,
    pub coverage: CalcCoverageType,
    pub safety_score: u32,
    pub base_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalcResult {
    pub premium: i128,
    pub config_version: u32,
}

// ── contractclient! binding ───────────────────────────────────────────────────

/// Generated client for the PremiumCalculator contract.
#[contractclient(name = "PremiumCalculatorClient")]
#[allow(dead_code)]
pub trait PremiumCalculatorTrait {
    fn compute(env: Env, input: CalcInput) -> Result<CalcResult, soroban_sdk::Error>;
    fn get_version(env: Env) -> u32;
    fn version(env: Env) -> soroban_sdk::String;
}

// ── Calculator versioning ─────────────────────────────────────────────────────

/// Storage key for the expected calculator contract version.
/// When set, every cross-contract call asserts the calculator's `get_version()`
/// matches this value before proceeding.
const CALC_EXPECTED_VERSION_KEY: &str = "calc_exp_ver";

/// Store the expected calculator version in instance storage.
pub fn set_expected_calc_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&soroban_sdk::Symbol::new(env, CALC_EXPECTED_VERSION_KEY), &version);
}

/// Read the expected calculator version (None = version check disabled).
pub fn get_expected_calc_version(env: &Env) -> Option<u32> {
    env.storage()
        .instance()
        .get(&soroban_sdk::Symbol::new(env, CALC_EXPECTED_VERSION_KEY))
}

/// Remove the expected calculator version (disables version check).
pub fn clear_expected_calc_version(env: &Env) {
    env.storage()
        .instance()
        .remove(&soroban_sdk::Symbol::new(env, CALC_EXPECTED_VERSION_KEY));
}

/// Admin entrypoint: atomically update the calculator contract address and expected version.
/// Both are written together or neither is written (Soroban transactions are atomic).
///
/// Pass `expected_version = 0` to disable version checking.
pub fn set_calculator_with_version(
    env: &Env,
    calculator: &Address,
    expected_version: u32,
) {
    storage::set_calc_address(env, calculator);
    if expected_version == 0 {
        clear_expected_calc_version(env);
    } else {
        set_expected_calc_version(env, expected_version);
    }
}

// ── Public helper ─────────────────────────────────────────────────────────────

/// Compute a premium quote, routing to the external calculator when configured.
///
/// `asset` is used to look up an asset-specific multiplier table when no
/// external calculator is configured. Pass `None` to use the global default.
///
/// Routing logic:
/// - If `CalcAddress` is set → cross-contract call; errors bubble up as
///   `CalculatorCallFailed` (or `CalculatorPaused` for CalcError::Paused = 17).
/// - If `CalcAddress` is absent → local `premium::compute_premium` fallback,
///   using the asset-specific table when available.
pub fn compute_quote(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
    asset: Option<&Address>,
) -> Result<PremiumQuote, Error> {
    match storage::get_calc_address(env) {
        Some(calc_addr) => match call_external(env, &calc_addr, input, base_amount, quote_ttl) {
            Ok(quote) => Ok(quote),
            Err(Error::CalculatorPaused) => Err(Error::CalculatorPaused),
            Err(_) => call_local(env, input, base_amount, include_breakdown, quote_ttl, asset),
        },
        None => call_local(env, input, base_amount, include_breakdown, quote_ttl, asset),
    }
}

fn call_external(
    env: &Env,
    calc_addr: &Address,
    input: &RiskInput,
    base_amount: i128,
    quote_ttl: u32,
) -> Result<PremiumQuote, Error> {
    let client = PremiumCalculatorClient::new(env, calc_addr);

    // Version guard: if an expected version is configured, assert it matches
    // the calculator's reported version before calling compute.
    if let Some(expected_ver) = get_expected_calc_version(env) {
        let actual_ver = client.get_version();
        if actual_ver != expected_ver {
            return Err(Error::CalculatorVersionMismatch);
        }
    }

    let calc_input = to_calc_input(input, base_amount);

    // try_compute returns:
    //   Ok(Ok(CalcResult))          — success
    //   Ok(Err(conversion_err))     — type conversion failure (treat as call failed)
    //   Err(Ok(CalcError))          — calculator returned a typed error
    //   Err(Err(InvokeError))       — host-level abort / panic
    let result = client.try_compute(&calc_input).map_err(|outer_err| {
        match outer_err {
            // Typed contract error — distinguish Paused (code 17) from others
            Ok(calc_err) => {
                use soroban_sdk::InvokeError;
                // CalcError is a contracterror; convert to InvokeError to read code
                let invoke: InvokeError = calc_err.into();
                match invoke {
                    InvokeError::Contract(17) => Error::CalculatorPaused,
                    _ => Error::CalculatorCallFailed,
                }
            }
            // Host abort / panic
            Err(_) => Error::CalculatorCallFailed,
        }
    })?;

    // Inner Ok: successful deserialization of CalcResult
    let calc_result = result.map_err(|_| Error::CalculatorCallFailed)?;

    let current_ledger = env.ledger().sequence();
    let valid_until_ledger = current_ledger
        .checked_add(quote_ttl)
        .ok_or(Error::Overflow)?;

    Ok(PremiumQuote {
        total_premium: calc_result.premium,
        line_items: None, // external calculator does not return line items
        valid_until_ledger,
        config_version: calc_result.config_version,
    })
}

fn call_local(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
    asset: Option<&Address>,
) -> Result<PremiumQuote, Error> {
    let table = match asset {
        Some(a) => premium::get_table_for_asset(env, a),
        None => storage::get_multiplier_table(env),
    };
    let computation = premium::compute_premium(input, base_amount, &table)?;
    let line_items = if include_breakdown {
        Some(premium::build_line_items(env, &computation))
    } else {
        None
    };
    let current_ledger = env.ledger().sequence();
    let valid_until_ledger = current_ledger
        .checked_add(quote_ttl)
        .ok_or(Error::Overflow)?;
    Ok(PremiumQuote {
        total_premium: computation.total_premium,
        line_items,
        valid_until_ledger,
        config_version: computation.config_version,
    })
}

// ── Type conversion ───────────────────────────────────────────────────────────

fn to_calc_input(input: &RiskInput, base_amount: i128) -> CalcInput {
    CalcInput {
        region: match input.region {
            RegionTier::Low => CalcRegionTier::Low,
            RegionTier::Medium => CalcRegionTier::Medium,
            RegionTier::High => CalcRegionTier::High,
        },
        age_band: match input.age_band {
            AgeBand::Young => CalcAgeBand::Young,
            AgeBand::Adult => CalcAgeBand::Adult,
            AgeBand::Senior => CalcAgeBand::Senior,
        },
        coverage: match input.coverage {
            CoverageTier::Basic => CalcCoverageType::Basic,
            CoverageTier::Standard => CalcCoverageType::Standard,
            CoverageTier::Premium => CalcCoverageType::Premium,
        },
        safety_score: input.safety_score,
        base_amount,
    }
}
