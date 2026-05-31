#![no_std]
#![allow(clippy::too_many_arguments)]

pub mod admin;
mod calculator;
mod claim;
pub mod commit_reveal;
pub mod delegation;
pub mod events;
mod governance_token;
mod ledger;
pub mod policy;
pub mod policy_lifecycle;
pub mod premium;
pub mod premium_pure;
mod rolling_claim_cap;
pub mod storage;
mod token;
pub mod types;
pub mod validate;

#[cfg(feature = "experimental")]
mod oracle;
#[cfg(feature = "experimental")]
pub use oracle::*;

use soroban_sdk::{contract, contractevent, contractimpl, panic_with_error, Address, Env, Vec};

#[contract]
pub struct NiffyInsure;
pub use admin::{AdminAction, AdminError, PendingAdminAction};
pub use policy::{PolicyError, RenewalError};
pub use policy_lifecycle::PolicyError as LifecyclePolicyError;

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[soroban_sdk::contracterror]
#[repr(u32)]
pub enum InitError {
    AlreadyInitialized = 1,
}

#[contractevent(topics = ["niffyinsure", "allowed_asset_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AllowedAssetUpdated {
    #[topic]
    pub asset: Address,
    pub allowed: bool,
}

#[contractevent(topics = ["niffyinsure", "voting_duration_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct VotingDurationUpdated {
    pub old_ledgers: u32,
    pub new_ledgers: u32,
}

#[contractevent(topics = ["niffyinsure", "asset_claim_bounds_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AssetClaimBoundsUpdated {
    #[topic]
    pub asset: Address,
    pub min_claim_amount: i128,
    pub max_claim_amount: i128,
}

#[contractevent(topics = ["niffyinsure", "reinsurance_contract_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ReinsuranceContractUpdated {
    pub reinsurance_contract: Address,
}

#[contractevent(topics = ["niffyinsure", "quorum_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct QuorumUpdated {
    pub old_bps: u32,
    pub new_bps: u32,
}

#[contractevent(topics = ["niffyinsure", "policy_type_registered"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct PolicyTypeRegistered {
    pub policy_type: types::PolicyType,
    /// `true` = registered/active, `false` = deregistered/inactive.
    pub active: bool,
}

#[contractevent(topics = ["niffyinsure", "pause_toggled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct PauseToggled {
    #[topic]
    pub admin: Address,
    pub paused: bool,
    pub reason_code: u32,
    pub bind_paused: bool,
    pub claims_paused: bool,
}

#[allow(clippy::too_many_arguments)]
#[contractimpl]
impl NiffyInsure {
    /// One-time initialisation: store admin and token contract address, and
    /// seed the default premium table so quote generation is deterministic.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), InitError> {
        admin.require_auth();
        if env.storage().instance().has(&storage::DataKey::Admin) {
            return Err(InitError::AlreadyInitialized);
        }
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_multiplier_table(&env, &premium::default_multiplier_table(&env));
        storage::set_allowed_asset(&env, &token, true);
        storage::set_voting_duration_ledgers(&env, ledger::VOTE_WINDOW_LEDGERS);
        storage::set_quorum_bps(&env, types::DEFAULT_QUORUM_BPS);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    /// Returns the semver version string stamped at build time from `Cargo.toml`.
    /// Read-only: no storage access, no auth required. Safe to call via simulation.
    pub fn version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    /// Read-only: on-chain WASM hash for this deployed contract.
    /// The returned value is the canonical hash used by the deployment registry and RPC tooling.
    pub fn get_wasm_hash(env: Env) -> soroban_sdk::BytesN<32> {
        env.deployer().current_contract_wasm_hash()
    }

    /// Read-only: balance of the default payout token held by this contract (payout reserve).
    /// Matches funds available for `process_claim` for the configured default asset.
    pub fn get_treasury_balance(env: Env) -> i128 {
        let token_addr = storage::get_token(&env);
        crate::token::get_treasury_balance(&env, &token_addr)
    }

    /// Pure quote path: reads config and computes premium only.
    /// This entrypoint intentionally performs no persistent writes.
    pub fn generate_premium(
        env: Env,
        input: types::RiskInput,
        base_amount: i128,
        include_breakdown: bool,
    ) -> Result<types::PremiumQuote, validate::Error> {
        policy::generate_premium(
            &env,
            input.region,
            input.age_band,
            input.coverage,
            input.safety_score,
            base_amount,
            include_breakdown,
            None,
        )
    }

    /// Like `generate_premium` but uses the asset-specific multiplier table when configured.
    /// Falls back to the global default table when no asset-specific table exists.
    pub fn generate_premium_for_asset(
        env: Env,
        input: types::RiskInput,
        base_amount: i128,
        include_breakdown: bool,
        asset: Address,
    ) -> Result<types::PremiumQuote, validate::Error> {
        policy::generate_premium(
            &env,
            input.region,
            input.age_band,
            input.coverage,
            input.safety_score,
            base_amount,
            include_breakdown,
            Some(&asset),
        )
    }

    pub fn quote_error_message(env: Env, code: u32) -> policy::QuoteFailure {
        let err = match code {
            1 => validate::Error::ZeroCoverage,
            2 => validate::Error::ZeroPremium,
            3 => validate::Error::InvalidLedgerWindow,
            4 => validate::Error::PolicyExpired,
            5 => validate::Error::PolicyInactive,
            6 => validate::Error::ClaimAmountZero,
            7 => validate::Error::ClaimExceedsCoverage,
            8 => validate::Error::DetailsTooLong,
            9 => validate::Error::TooManyImageUrls,
            10 => validate::Error::ImageUrlTooLong,
            11 => validate::Error::ReasonTooLong,
            12 => validate::Error::ClaimAlreadyTerminal,
            13 => validate::Error::DuplicateVote,
            14 => validate::Error::InvalidBaseAmount,
            15 => validate::Error::SafetyScoreOutOfRange,
            16 => validate::Error::InvalidConfigVersion,
            17 => validate::Error::MissingRegionMultiplier,
            18 => validate::Error::MissingAgeMultiplier,
            19 => validate::Error::MissingCoverageMultiplier,
            20 => validate::Error::RegionMultiplierOutOfBounds,
            21 => validate::Error::AgeMultiplierOutOfBounds,
            22 => validate::Error::CoverageMultiplierOutOfBounds,
            23 => validate::Error::SafetyDiscountOutOfBounds,
            24 => validate::Error::Overflow,
            25 => validate::Error::DivideByZero,
            26 => validate::Error::InvalidQuoteTtl,
            27 => validate::Error::NegativePremiumNotSupported,
            28 => validate::Error::ClaimNotFound,
            29 => validate::Error::InvalidAsset,
            30 => validate::Error::InsufficientTreasury,
            31 => validate::Error::AlreadyPaid,
            32 => validate::Error::ClaimNotApproved,
            33 => validate::Error::DuplicateOpenClaim,
            34 => validate::Error::ExcessiveEvidenceBytes,
            35 => validate::Error::PolicyNotFound,
            36 => validate::Error::CalculatorNotSet,
            37 => validate::Error::CalculatorCallFailed,
            38 => validate::Error::CalculatorPaused,
            39 => validate::Error::VotingWindowClosed,
            40 => validate::Error::VotingWindowStillOpen,
            41 => validate::Error::NotEligibleVoter,
            42 => validate::Error::RateLimitExceeded,
            49 => validate::Error::VotingDurationOutOfBounds,
            50 => validate::Error::PolicyBatchTooLarge,
            51 => validate::Error::VoterSnapshotExpired,
            52 => validate::Error::NonceMismatch,
            53 => validate::Error::ClaimNotProcessing,
            54 => validate::Error::RollingClaimCapExceeded,
            55 => validate::Error::PayoutDeadlineNotReached,
            _ => validate::Error::ClaimNotApproved,
        };
        policy::map_quote_error(&env, err)
    }

    pub fn update_multiplier_table(
        env: Env,
        new_table: types::MultiplierTable,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        premium::update_multiplier_table(&env, &new_table)
    }

    /// Admin-only: update a single multiplier entry without redeploying the contract.
    ///
    /// Emits `PremiumMultiplierUpdated` with the key, old value, and new value.
    /// Premium calculations use the updated value immediately after this call.
    ///
    /// # Bounds
    /// - Region / Age / Coverage keys: `MIN_MULTIPLIER..=MAX_MULTIPLIER` (5_000–20_000)
    /// - SafetyDiscount key: `0..=MAX_SAFETY_DISCOUNT` (0–5_000)
    pub fn admin_set_premium_multiplier(
        env: Env,
        key: types::MultiplierKey,
        value: i128,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::bump_instance(&env);
        premium::admin_set_premium_multiplier(&env, key, value)
    }

    pub fn get_multiplier_table(env: Env) -> types::MultiplierTable {
        storage::get_multiplier_table(&env)
    }

    /// Admin-only: add or remove an asset from the allowlist.
    /// Always emits `asset_set` (idempotent — even if the state is unchanged).
    pub fn set_allowed_asset(
        env: Env,
        asset: Address,
        allowed: bool,
        symbol_hint: soroban_sdk::String,
        decimals: u32,
    ) {
        let _admin = admin::require_admin(&env);
        storage::bump_instance(&env);
        claim::set_allowed_asset(&env, &asset, allowed);
        AllowedAssetUpdated {
            asset: asset.clone(),
            allowed,
        }
        .publish(&env);
        events::emit_asset_allowlisted(
            &env,
            &asset,
            allowed,
            if allowed {
                symbol_hint
            } else {
                soroban_sdk::String::from_str(&env, "")
            },
            if allowed { decimals } else { 0 },
        );
    }

    pub fn is_allowed_asset(env: Env, asset: Address) -> bool {
        storage::is_allowed_asset(&env, &asset)
    }

    pub fn file_claim(
        env: Env,
        holder: Address,
        policy_id: u32,
        amount: i128,
        details: soroban_sdk::String,
        evidence: Vec<types::ClaimEvidenceEntry>,
        expected_nonce: Option<u64>,
    ) -> Result<u64, validate::Error> {
        holder.require_auth();
        claim::file_claim(
            &env,
            &holder,
            policy_id,
            amount,
            &details,
            &evidence,
            expected_nonce,
        )
    }

    /// Claimant-only: withdraw before any vote is cast (`Processing`, zero tallies).
    pub fn withdraw_claim(
        env: Env,
        claimant: Address,
        claim_id: u64,
    ) -> Result<(), validate::Error> {
        claimant.require_auth();
        claim::withdraw_claim(&env, &claimant, claim_id)
    }

    pub fn vote_on_claim(
        env: Env,
        voter: Address,
        claim_id: u64,
        vote: types::VoteOption,
    ) -> Result<types::ClaimStatus, validate::Error> {
        voter.require_auth();
        claim::vote_on_claim(&env, &voter, claim_id, &vote)
    }

    /// Permissionless keeper hook: bump persistent TTL for the claim voter snapshot.
    /// Does not alter eligibility or tallies.
    pub fn refresh_snapshot(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        claim::refresh_snapshot(&env, claim_id)
    }

    pub fn finalize_claim(env: Env, claim_id: u64) -> Result<types::ClaimStatus, validate::Error> {
        claim::finalize_claim(&env, claim_id)
    }

    /// Permissionless keeper: finalize claim when past `voting_deadline_ledger` (same rules as `finalize_claim`).
    pub fn process_deadline(
        env: Env,
        claim_id: u64,
    ) -> Result<types::ClaimStatus, validate::Error> {
        claim::process_deadline(&env, claim_id)
    }

    /// Permissionless keeper: finalize multiple expired claims in one transaction.
    ///
    /// Processes each claim independently; skips already-finalized or ineligible claims.
    /// Reverts before any processing if `claim_ids.len() > BATCH_FINALIZE_MAX` (20).
    /// Returns `(processed, skipped)` counts.
    pub fn finalize_expired_batch(
        env: Env,
        claim_ids: soroban_sdk::Vec<u64>,
    ) -> Result<(u32, u32), validate::Error> {
        claim::finalize_expired_batch(&env, &claim_ids)
    }

    /// Permissionless keeper: auto-reject an approved claim once its payout deadline has elapsed.
    pub fn process_payout_timeout(
        env: Env,
        claim_id: u64,
    ) -> Result<types::ClaimStatus, validate::Error> {
        claim::process_payout_timeout(&env, claim_id)
    }

    pub fn get_claim_history(
        env: Env,
        claim_id: u64,
    ) -> Result<Vec<types::ClaimStatusHistoryEntry>, validate::Error> {
        claim::get_claim_history(&env, claim_id)
    }

    pub fn get_vote_duration_ledgers(env: Env) -> u32 {
        storage::get_voting_duration_ledgers(&env)
    }

    pub fn admin_set_vote_duration_ledgers(env: Env, ledgers: u32) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        ledger::validate_voting_duration_ledgers(ledgers)?;
        storage::set_voting_duration_ledgers(&env, ledgers);
        Ok(())
    }

    /// Participation quorum in basis points (1–10_000). Applies to **new** claims only;
    /// each claim stores a snapshot at `file_claim` so `Processing` claims keep their `quorum_bps`.
    pub fn get_quorum_bps(env: Env) -> u32 {
        storage::get_quorum_bps(&env)
    }

    /// Basis points snapshot for this claim (immutable after filing).
    pub fn get_claim_quorum_bps(env: Env, claim_id: u64) -> u32 {
        storage::get_claim_quorum_bps(&env, claim_id)
    }

    pub fn admin_set_quorum_bps(env: Env, quorum_bps: u32) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        validate::validate_quorum_bps(quorum_bps)?;
        let old = storage::get_quorum_bps(&env);
        storage::set_quorum_bps(&env, quorum_bps);
        QuorumUpdated {
            old_bps: old,
            new_bps: quorum_bps,
        }
        .publish(&env);
        Ok(())
    }

    // ── Grace period ──────────────────────────────────────────────────────────

    /// Admin-only: set the grace period (in ledgers) after nominal expiry during
    /// which late renewals are still accepted. Emits GracePeriodUpdated.
    pub fn set_grace_period_ledgers(env: Env, ledgers: u32) -> Result<(), policy::RenewalError> {
        storage::bump_instance(&env);
        policy::set_grace_period_ledgers(&env, ledgers)
    }

    pub fn get_grace_period_ledgers(env: Env) -> u32 {
        policy::get_grace_period_ledgers(&env)
    }

    pub fn process_claim(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::process_claim(&env, claim_id)
    }

    /// Admin-only: dispute an approved claim during the dispute window.
    pub fn admin_dispute_claim(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::dispute_claim(&env, claim_id)
    }

    pub fn get_claim(env: Env, claim_id: u64) -> Result<types::Claim, validate::Error> {
        claim::get_claim(&env, claim_id)
    }

    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    /// Paginated listing of claims by claim_id range, ordered ascending.
    ///
    /// `start_after` is an exclusive cursor: pass `0` for the first page, or the
    /// last `claim_id` received to advance to the next page.
    /// `limit` is capped at `PAGE_SIZE_MAX` (20); larger values are silently clamped.
    ///
    /// Returns summary structs — call `get_claim` for the full record.
    ///
    /// Empty page (len == 0) means no more results exist beyond the cursor.
    /// Because claim_ids are monotonically increasing and never deleted, a
    /// stale cursor never panics — it simply returns an empty page.
    pub fn list_claims(env: Env, start_after: u64, limit: u32) -> Vec<types::ClaimSummary> {
        let cap = limit.min(types::PAGE_SIZE_MAX);
        let total = storage::get_claim_counter(&env);
        let mut results: Vec<types::ClaimSummary> = Vec::new(&env);
        let mut id: u64 = start_after.saturating_add(1);
        while id <= total && results.len() < cap {
            if let Some(c) = storage::get_claim(&env, id) {
                results.push_back(types::ClaimSummary {
                    claim_id: c.claim_id,
                    policy_id: c.policy_id,
                    amount: c.amount,
                    deductible: c.deductible,
                    status: c.status,
                    filed_at: c.filed_at,
                    voting_deadline_ledger: c.voting_deadline_ledger,
                });
            }
            id = id.saturating_add(1);
        }
        results
    }

    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    pub fn get_voters(env: Env) -> Vec<Address> {
        storage::get_voters(&env)
    }

    pub fn voter_registry_len(env: Env) -> u32 {
        storage::get_voters(&env).len()
    }

    pub fn voter_registry_contains(env: Env, holder: Address) -> bool {
        storage::get_voters(&env).iter().any(|v| v == holder)
    }

    pub fn holder_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_holder_active_policy_count(&env, &holder)
    }

    pub fn set_calculator(env: Env, calculator: Address) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::set_calc_address(&env, &calculator);
    }

    pub fn clear_calculator(env: Env) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .remove(&storage::DataKey::CalcAddress);
    }

    pub fn get_calculator(env: Env) -> Option<Address> {
        storage::get_calc_address(&env)
    }

    // ── Policy domain ────────────────────────────────────────────────────

    /// Turn an accepted quote into an enforceable on-chain policy.
    ///
    /// `asset` must be on the admin-controlled allowlist; it is bound to the
    /// policy and used for both premium payment and future claim payouts.
    pub fn initiate_policy(
        env: Env,
        holder: Address,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        age_band: types::AgeBand,
        coverage_type: types::CoverageTier,
        safety_score: u32,
        base_amount: i128,
        asset: Address,
        opts: types::InitiatePolicyOptions,
    ) -> Result<types::Policy, policy::PolicyError> {
        policy::initiate_policy(
            &env,
            holder,
            policy_type,
            region,
            age_band,
            coverage_type,
            safety_score,
            base_amount,
            asset,
            opts.beneficiary,
            opts.deductible,
            opts.expected_nonce,
            opts.metadata_uri,
        )
    }

    /// Set or clear the payout beneficiary. Holder-authenticated only.
    pub fn set_beneficiary(
        env: Env,
        holder: Address,
        policy_id: u32,
        beneficiary: Option<Address>,
    ) -> Result<(), policy::PolicyError> {
        policy::set_beneficiary(&env, holder, policy_id, beneficiary)
    }

    /// Admin-only: update the policy metadata URI.
    pub fn admin_update_policy_metadata_uri(
        env: Env,
        holder: Address,
        policy_id: u32,
        new_uri: soroban_sdk::String,
    ) -> Result<(), policy::PolicyError> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        policy::update_policy_metadata_uri(&env, holder, policy_id, new_uri)
    }

    /// Read-only: retrieve a persisted policy by (holder, policy_id).
    pub fn get_policy(env: Env, holder: Address, policy_id: u32) -> Option<types::Policy> {
        storage::get_policy(&env, &holder, policy_id)
    }

    /// Batch-read policies in one simulation/RPC round-trip.
    ///
    /// Returns `Vec` aligned with `ids`: `out[i]` is `Some(policy)` or `None` if that
    /// key is missing — absent keys never revert the whole batch.
    ///
    /// # Hard cap — **`POLICY_BATCH_GET_MAX` (20)**
    ///
    /// Matches [`types::PAGE_SIZE_MAX`]: each entry is an independent storage read, so
    /// large batches multiply metered reads and can exceed the default Soroban
    /// instruction budget during simulation. Dashboards and indexers must chunk
    /// requests. **More than 20 keys reverts** with [`validate::Error::PolicyBatchTooLarge`]
    /// (unlike `list_policies`, which clamps `limit` instead of erroring).
    ///
    /// The cap is checked **before** any policy storage access (no unbounded iteration).
    pub fn get_policies_batch(
        env: Env,
        ids: Vec<types::PolicyLookupKey>,
    ) -> Vec<Option<types::Policy>> {
        if ids.len() > types::POLICY_BATCH_GET_MAX {
            panic_with_error!(&env, validate::Error::PolicyBatchTooLarge);
        }
        let mut out: Vec<Option<types::Policy>> = Vec::new(&env);
        for i in 0..ids.len() {
            let key = ids.get(i).unwrap();
            out.push_back(storage::get_policy(&env, &key.holder, key.policy_id));
        }
        out
    }

    /// Paginated listing of a holder's policies, ordered by ascending policy_id.
    ///
    /// `start_after` is an exclusive cursor: pass `0` for the first page, or the
    /// last `policy_id` received to advance to the next page.
    /// `limit` is capped at `PAGE_SIZE_MAX` (20); larger values are silently clamped.
    ///
    /// Returns summary structs — call `get_policy` for the full record.
    ///
    /// Empty page (len == 0) means no more results exist beyond the cursor.
    /// Because policy_ids are monotonically increasing and never deleted, a
    /// stale cursor never panics — it simply returns an empty page.
    pub fn list_policies(
        env: Env,
        holder: Address,
        start_after: u32,
        limit: u32,
    ) -> Vec<types::PolicySummary> {
        let cap = limit.min(types::PAGE_SIZE_MAX);
        let total = storage::get_policy_counter(&env, &holder);
        let mut results: Vec<types::PolicySummary> = Vec::new(&env);
        let mut id: u32 = start_after.saturating_add(1);
        while id <= total && results.len() < cap {
            if let Some(p) = storage::get_policy(&env, &holder, id) {
                results.push_back(types::PolicySummary {
                    policy_id: p.policy_id,
                    policy_type: p.policy_type,
                    coverage: p.coverage,
                    is_active: p.is_active,
                    end_ledger: p.end_ledger,
                });
            }
            id = id.saturating_add(1);
        }
        results
    }

    /// Read-only: number of active policies for a holder (= vote weight).
    pub fn get_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_active_policy_count(&env, &holder)
    }

    /// Read-only: current replay-protection nonce for `holder`.
    /// Pass this value as `expected_nonce` in the next `initiate_policy` or `file_claim`
    /// call to enable nonce checking. Nonce starts at 0 and increments on each
    /// successful mutating call where `expected_nonce` was supplied.
    pub fn get_nonce(env: Env, holder: Address) -> u64 {
        storage::get_holder_nonce(&env, &holder)
    }

    /// If set, the `end_ledger` for which a [`policy::PolicyExpired`] event was already recorded
    /// (one row per policy). Indexers may use this with `get_policy` for idempotency checks.
    /// Name is shortened to satisfy the 32-char Soroban export limit.
    pub fn get_pol_exp_evt_end_ledger(env: Env, holder: Address, policy_id: u32) -> Option<u32> {
        storage::get_policy_expired_event_end_ledger(&env, &holder, policy_id)
    }

    /// Keeper hook: when `ledger_sequence >= policy.end_ledger`, emit [`policy::PolicyExpired`]
    /// once per policy term (see `policy` module docs for notification delay). Reverts if the
    /// policy does not exist or is not yet expired.
    pub fn process_expired(
        env: Env,
        holder: Address,
        policy_id: u32,
    ) -> Result<(), policy::PolicyError> {
        // Record expiry event when now >= end_ledger (even during grace period).
        // Deactivate when now >= end + grace (after grace period ends).
        let result = policy::process_expired(&env, holder.clone(), policy_id);
        // Also attempt lifecycle deactivation; ignore NotYetExpired (still in grace).
        let _ = policy_lifecycle::process_expired(&env, holder, policy_id).map_err(|e| match e {
            policy_lifecycle::PolicyError::PolicyNotFound => policy::PolicyError::NotFound,
            policy_lifecycle::PolicyError::PolicyLapseNotReached => {
                policy::PolicyError::NotYetExpired
            }
            _ => policy::PolicyError::NotYetExpired,
        });
        result
    }

    /// Renew before `end_ledger` (renewal window). If already expired, emits [`policy::PolicyExpired`]
    /// when due and returns [`types::RenewPolicyOutcome::Lapsed`] in **`Ok`** (see type docs).
    pub fn renew_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        age_band: types::AgeBand,
        coverage_type: types::CoverageType,
        safety_score: u32,
    ) -> Result<types::RenewPolicyOutcome, policy::PolicyError> {
        policy::renew_policy(
            &env,
            holder,
            policy_id,
            age_band,
            coverage_type,
            safety_score,
        )
    }

    pub fn terminate_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        reason: types::TerminationReason,
    ) -> Result<(), policy_lifecycle::PolicyError> {
        policy_lifecycle::terminate_policy(&env, holder, policy_id, reason)
    }

    pub fn admin_terminate_policy(
        env: Env,
        admin: Address,
        holder: Address,
        policy_id: u32,
        reason: types::TerminationReason,
        allow_open_claims: bool,
    ) -> Result<(), policy_lifecycle::PolicyError> {
        policy_lifecycle::admin_terminate_policy(
            &env,
            admin,
            holder,
            policy_id,
            reason,
            allow_open_claims,
        )
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        admin::propose_admin(&env, new_admin);
    }

    pub fn accept_admin(env: Env) {
        admin::accept_admin(&env);
    }

    pub fn cancel_admin(env: Env) {
        admin::cancel_admin(&env);
    }

    /// Propose a high-risk admin action for two-step confirmation.
    pub fn propose_admin_action(env: Env, action: AdminAction) {
        admin::propose_admin_action(&env, action);
    }

    /// Confirm and execute pending admin action (second signer auth).
    pub fn confirm_admin_action(env: Env, confirmer: Address) {
        confirmer.require_auth();
        admin::confirm_admin_action(&env, confirmer);
    }

    /// Cancel pending admin action (proposer auth).
    pub fn cancel_admin_action(env: Env) {
        admin::cancel_admin_action(&env);
    }

    pub fn set_token(env: Env, new_token: Address) {
        admin::set_token(&env, new_token);
    }

    pub fn set_treasury(env: Env, new_treasury: Address) {
        admin::set_treasury(&env, new_treasury);
    }

    pub fn drain(env: Env, recipient: Address, amount: i128) {
        admin::drain(&env, recipient, amount);
    }

    /// Emergency token sweep: recover mistakenly sent tokens with strict ethical constraints.
    ///
    /// # Security & Ethics
    /// - Admin-only (requires multisig in production)
    /// - Asset must be allowlisted
    /// - Optional per-transaction cap
    /// - Protected balance check (won't violate approved claims)
    /// - Comprehensive audit trail
    ///
    /// # Parameters
    /// - `asset`: Token contract address (must be allowlisted)
    /// - `recipient`: Destination for swept tokens
    /// - `amount`: Amount to sweep (must be > 0)
    /// - `reason_code`: Audit code (1=accidental transfer, 2=test tokens, 3=airdrop, etc.)
    ///
    /// See SWEEP_RUNBOOK.md for operational guidance and legal requirements.
    pub fn sweep_token(
        env: Env,
        asset: Address,
        recipient: Address,
        amount: i128,
        reason_code: u32,
    ) {
        admin::sweep_token(&env, asset, recipient, amount, reason_code);
    }

    /// Set optional per-transaction cap for sweep operations.
    /// Pass None to disable cap. Admin-only.
    pub fn set_sweep_cap(env: Env, cap: Option<i128>) {
        admin::set_sweep_cap(&env, cap);
    }

    /// Get current sweep cap (None if not set).
    pub fn get_sweep_cap(env: Env) -> Option<i128> {
        storage::get_sweep_cap(&env)
    }

    /// Set the on-chain notice period (in ledgers) that must elapse between a sweep
    /// proposal and its execution. 0 = disabled. Admin-only.
    /// Recommended mainnet value: 2880 (~4 hours at 5s/ledger).
    pub fn set_sweep_notice_period(env: Env, ledgers: u32) {
        admin::set_sweep_notice_period(&env, ledgers);
    }

    /// Get the current sweep notice period in ledgers (0 = disabled).
    pub fn get_sweep_notice_period(env: Env) -> u32 {
        storage::get_sweep_notice_period_ledgers(&env)
    }

    /// Admin-only: set the maximum number of evidence entries per claim.
    /// Hard max is [`storage::MAX_EVIDENCE_COUNT_HARD_MAX`] (20).
    /// Reductions do NOT retroactively invalidate existing claims.
    pub fn admin_set_max_evidence_count(env: Env, new_count: u32) -> Result<(), AdminError> {
        admin::set_max_evidence_count(&env, new_count)
    }

    /// Read the current max evidence count (falls back to compile-time default when unset).
    pub fn get_max_evidence_count(env: Env) -> u32 {
        storage::get_max_evidence_count(&env)
    }

    /// Admin-only: update the allowlisted IPFS gateway URL prefixes for evidence validation.
    /// Evidence URLs must start with `ipfs://` or one of the allowlisted gateway prefixes.
    pub fn admin_set_gateway_allowlist(env: Env, gateways: Vec<String>) -> Result<(), AdminError> {
        admin::set_gateway_allowlist(&env, gateways)
    }

    /// Read the current allowlisted IPFS gateway URL prefixes.
    pub fn get_gateway_allowlist(env: Env) -> Vec<String> {
        storage::get_gateway_allowlist(&env)
    }

    // ── Per-asset premium table ───────────────────────────────────────────────

    /// Admin-only: set an asset-specific multiplier table.
    ///
    /// The asset must be allowlisted. The table must pass the same shape and
    /// bounds validation as the global table. Version must be strictly greater
    /// than any previously stored asset-specific table for this asset.
    ///
    /// Pass `None` for `table` to remove the asset-specific table and revert
    /// to the global default for that asset.
    ///
    /// Emits `AssetPremiumTableSet`.
    pub fn admin_set_asset_premium_table(
        env: Env,
        asset: Address,
        table: Option<types::MultiplierTable>,
    ) -> Result<(), validate::Error> {
        admin::require_admin(&env);
        premium::admin_set_asset_premium_table(&env, &asset, table)
    }

    /// Read the asset-specific multiplier table for `asset`.
    /// Returns `None` when no asset-specific table has been set (global default applies).
    pub fn get_asset_premium_table(
        env: Env,
        asset: Address,
    ) -> Option<types::MultiplierTable> {
        storage::get_asset_premium_table(&env, &asset)
    }

    // ── Policy type registry ──────────────────────────────────────────────────

    /// Admin-only: register or update a policy type in the registry.
    ///
    /// Once registered and active, `initiate_policy` will accept this type.
    /// Emits `PolicyTypeRegistered`.
    pub fn admin_register_policy_type(
        env: Env,
        policy_type: types::PolicyType,
        config: types::PolicyTypeConfig,
    ) -> Result<(), admin::AdminError> {
        admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_policy_type_config(&env, &policy_type, &config);
        storage::set_policy_type_active(&env, &policy_type, true);
        PolicyTypeRegistered {
            policy_type,
            active: true,
        }
        .publish(&env);
        Ok(())
    }

    /// Admin-only: deregister a policy type (marks it inactive).
    ///
    /// Existing policies of this type remain valid; only new initiations are blocked.
    /// Emits `PolicyTypeRegistered` with `active = false`.
    pub fn admin_deregister_policy_type(
        env: Env,
        policy_type: types::PolicyType,
    ) -> Result<(), admin::AdminError> {
        admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_policy_type_active(&env, &policy_type, false);
        PolicyTypeRegistered {
            policy_type,
            active: false,
        }
        .publish(&env);
        Ok(())
    }

    /// Read-only: returns `true` if the policy type is registered and active.
    pub fn is_policy_type_active(env: Env, policy_type: types::PolicyType) -> bool {
        storage::is_policy_type_active(&env, &policy_type)
    }

    /// Read-only: returns the config for a policy type, or `None` if not registered.
    pub fn get_policy_type_config(
        env: Env,
        policy_type: types::PolicyType,
    ) -> Option<types::PolicyTypeConfig> {
        storage::get_policy_type_config(&env, &policy_type)
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // PAUSE SYSTEM
    //
    // Granular pause flags for operational flexibility:
    //   - bind_paused: blocks new policy initiation/renewal
    //   - claims_paused: blocks filing claims and voting
    //
    // Admin-only toggles with optional reason codes.
    // Read-only methods continue to work for transparency.
    // ═════════════════════════════════════════════════════════════════════════════

    /// Pause the contract with optional reason code.
    /// Reason codes: 0=maintenance, 1=vulnerability, 2=key_compromise, 3=other
    /// Emits PauseToggled event with admin, paused=true, and reason code.
    pub fn pause(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");
        storage::set_paused(&env, true);

        let flags = storage::get_pause_flags(&env);
        PauseToggled {
            admin,
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Unpause the contract with optional reason code.
    /// Reason codes: 0=resolved, 1=manual, 2=other
    /// Emits PauseToggled event with admin, paused=false, and reason code.
    pub fn unpause(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can unpause");
        storage::set_paused(&env, false);

        let flags = storage::get_pause_flags(&env);
        PauseToggled {
            admin,
            paused: false,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Granular pause: pause only policy binding (initiate/renew).
    pub fn pause_bind(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");

        let mut flags = storage::get_pause_flags(&env);
        flags.bind_paused = true;
        storage::set_pause_flags(&env, &flags);

        PauseToggled {
            admin,
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Granular pause: pause only claims (file/vote/finalize).
    pub fn pause_claims(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");

        let mut flags = storage::get_pause_flags(&env);
        flags.claims_paused = true;
        storage::set_pause_flags(&env, &flags);

        PauseToggled {
            admin,
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Get current pause state (legacy - true if ANY pause flag is set).
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    /// Get detailed pause flags (bind_paused, claims_paused).
    pub fn get_pause_flags(env: Env) -> storage::PauseFlags {
        storage::get_pause_flags(&env)
    }

    // ── Rolling claim cap (ledger-window cumulative paid per policy) ─────────

    /// Global rolling cap on **paid** claim amounts per policy per ledger window (gross `claim.amount`).
    /// `i128::MAX` means effectively uncapped.
    pub fn get_rolling_claim_cap(env: Env) -> i128 {
        storage::get_rolling_claim_cap(&env)
    }

    /// Ledger length of each rolling window bucket (aligned to `ledger_sequence / window`).
    pub fn get_rolling_claim_window_ledgers(env: Env) -> u32 {
        storage::get_rolling_claim_window_ledgers(&env)
    }

    /// Remaining amount that can be **filed** this window before hitting the cap (`0` if at/over cap).
    /// Indexers can combine with cap and `get_rolling_claim_state` for full UI.
    pub fn get_rolling_claim_remaining(env: Env, holder: Address, policy_id: u32) -> i128 {
        let now = env.ledger().sequence();
        rolling_claim_cap::remaining_under_cap(&env, &holder, policy_id, now)
    }

    /// Raw rolling state for `(holder, policy_id)` if present (window bucket + cumulative paid).
    pub fn get_rolling_claim_state(
        env: Env,
        holder: Address,
        policy_id: u32,
    ) -> Option<types::RollingClaimWindowState> {
        storage::get_rolling_claim_state(&env, &holder, policy_id)
    }

    /// Admin: set rolling claim cap. Bounded unless `i128::MAX` (uncapped). Emits `ClaimCapUpdated`.
    pub fn set_rolling_claim_cap(env: Env, new_cap: i128) -> Result<(), AdminError> {
        let _admin = admin::require_admin(&env);
        rolling_claim_cap::try_set_cap(&env, new_cap)
    }

    /// Admin: set rolling window length in ledgers. Emits `RollingClaimWindowLedgersUpdated`.
    pub fn set_rolling_claim_window_ledgers(
        env: Env,
        window_ledgers: u32,
    ) -> Result<(), AdminError> {
        let _admin = admin::require_admin(&env);
        rolling_claim_cap::try_set_window_ledgers(&env, window_ledgers)
    }

    // ── Issue #583: Claim fraud score ─────────────────────────────────────────

    /// Admin or delegated oracle: set fraud score (0–100) for a claim.
    /// High-score claims require elevated quorum at finalization.
    pub fn set_claim_fraud_score(
        env: Env,
        caller: Address,
        claim_id: u64,
        score: u32,
    ) -> Result<(), validate::Error> {
        caller.require_auth();
        claim::set_claim_fraud_score(&env, &caller, claim_id, score)
    }

    /// Read the fraud score for a claim (None if not set).
    pub fn get_claim_fraud_score(env: Env, claim_id: u64) -> Option<u32> {
        storage::get_claim_fraud_score(&env, claim_id)
    }

    /// Admin: set the fraud score threshold above which elevated quorum applies.
    pub fn admin_set_fraud_score_threshold(env: Env, threshold: u32) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        if threshold > 100 {
            return Err(validate::Error::SafetyScoreOutOfRange);
        }
        storage::set_fraud_score_threshold(&env, threshold);
        Ok(())
    }

    /// Admin: set the elevated quorum bps used when fraud score exceeds threshold.
    pub fn admin_set_elevated_quorum_bps(env: Env, bps: u32) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        validate::validate_quorum_bps(bps)?;
        storage::set_elevated_quorum_bps(&env, bps);
        Ok(())
    }

    // ── Issue #587: Asset-specific claim amount bounds ────────────────────────

    /// Admin: set min/max claim amount bounds for an asset.
    /// Dust claims below min and over-coverage claims above max will revert.
    pub fn admin_set_asset_claim_bounds(
        env: Env,
        asset: Address,
        min_claim_amount: i128,
        max_claim_amount: i128,
    ) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        if min_claim_amount < 0 || max_claim_amount < min_claim_amount {
            return Err(validate::Error::ClaimAmountZero);
        }
        storage::set_allowed_asset_config(
            &env,
            &asset,
            &types::AllowedAssetConfig { min_claim_amount, max_claim_amount },
        );
        AssetClaimBoundsUpdated {
            asset,
            min_claim_amount,
            max_claim_amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Read the asset-specific claim bounds (None if not configured).
    pub fn get_asset_claim_bounds(env: Env, asset: Address) -> Option<types::AllowedAssetConfig> {
        storage::get_allowed_asset_config(&env, &asset)
    }

    // ── Issue #585: Admin role delegation ────────────────────────────────────

    /// Admin: grant a temporary delegation to `operator` with specific permissions.
    pub fn grant_delegation(
        env: Env,
        operator: Address,
        expiry_ledger: u32,
        permissions: types::DelegationPermissions,
    ) -> Result<(), validate::Error> {
        let admin = admin::require_admin(&env);
        delegation::grant_delegation(&env, &admin, &operator, expiry_ledger, permissions)
    }

    /// Admin: revoke a delegation before it expires.
    pub fn revoke_delegation(env: Env, operator: Address) {
        let admin = admin::require_admin(&env);
        delegation::revoke_delegation(&env, &admin, &operator);
    }

    /// Read a delegation record (None if not set or expired).
    pub fn get_delegation(env: Env, operator: Address) -> Option<types::DelegationRecord> {
        delegation::get_delegation(&env, &operator)
    }

    // ── Issue #581: Reinsurance pool ──────────────────────────────────────────

    /// Admin: set the reinsurance contract address.
    /// When primary treasury is insufficient, overflow is drawn from this contract.
    pub fn admin_set_reinsurance_contract(env: Env, reinsurance: Address) {
        let _admin = admin::require_admin(&env);
        storage::set_reinsurance_contract(&env, &reinsurance);
        ReinsuranceContractUpdated {
            reinsurance_contract: reinsurance,
        }
        .publish(&env);
    }

    /// Admin: clear the reinsurance contract (disables reinsurance fallback).
    pub fn admin_clear_reinsurance_contract(env: Env) {
        let _admin = admin::require_admin(&env);
        storage::clear_reinsurance_contract(&env);
    }

    /// Read the configured reinsurance contract address (None if not set).
    pub fn get_reinsurance_contract(env: Env) -> Option<Address> {
        storage::get_reinsurance_contract(&env)
    }
}

/// Keeper TTL Management entrypoints
#[contractimpl]
impl NiffyInsure {
    /// Keeper: extend TTL for a specific policy. Returns true if extended, false if policy not found.
    /// Prevents data loss for long-lived policies without admin intervention.
    pub fn bump_policy_ttl(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::bump_policy_ttl(&env, &holder, policy_id)
    }

    /// Keeper: extend TTL for all policies belonging to a holder. Returns count of policies extended.
    pub fn bump_holder_all_policies_ttl(env: Env, holder: Address) -> u32 {
        storage::bump_holder_all_policies_ttl(&env, &holder)
    }

    /// Keeper: extend TTL for all claim-related entries for a specific claim. Returns true if extended.
    pub fn bump_claim_ttl(env: Env, claim_id: u64) -> bool {
        storage::bump_claim_ttl(&env, claim_id)
    }

    /// Get TTL information for a policy (for monitoring/alerts). Returns remaining ledgers or None.
    pub fn get_policy_ttl_info(env: Env, holder: Address, policy_id: u32) -> Option<u32> {
        storage::get_policy_ttl_info(&env, &holder, policy_id)
    }

    /// Get TTL information for a claim (for monitoring/alerts). Returns remaining ledgers or None.
    pub fn get_claim_ttl_info(env: Env, claim_id: u64) -> Option<u32> {
        storage::get_claim_ttl_info(&env, claim_id)
    }

    /// Check if a policy's TTL is within the alert threshold. Returns true if near expiry.
    pub fn is_policy_ttl_near_expiry(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::is_policy_ttl_near_expiry(&env, &holder, policy_id)
    }

    /// Admin: set the TTL alert threshold for expiry notifications.
    pub fn set_ttl_alert_threshold(env: Env, threshold: u32) -> Result<(), AdminError> {
        let _admin = admin::require_admin(&env);
        storage::set_ttl_alert_threshold(&env, threshold);
        Ok(())
    }

    /// Get the current TTL alert threshold.
    pub fn get_ttl_alert_threshold(env: Env) -> u32 {
        storage::get_ttl_alert_threshold(&env)
    }
}

/// Governance token: reserved entrypoints only when built with `--features governance-token`.
/// No mint/transfer/balance logic — see `governance_token` module TODO.
#[cfg(feature = "governance-token")]
#[contractimpl]
impl NiffyInsure {
    pub fn gov_token_runtime_enabled(env: Env) -> bool {
        governance_token::governance_token_effective_enabled(&env)
    }

    pub fn gov_set_token_runtime_enabled(env: Env, admin: Address, enabled: bool) {
        admin.require_auth();
        let stored = storage::get_admin(&env);
        assert!(admin == stored, "only admin");
        storage::bump_instance(&env);
        governance_token::set_governance_token_runtime_enabled(&env, enabled);
    }

    pub fn gov_token_address(env: Env) -> Option<Address> {
        governance_token::get_governance_token_address(&env)
    }

    pub fn gov_set_token_address_stub(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        let stored = storage::get_admin(&env);
        assert!(admin == stored, "only admin");
        storage::bump_instance(&env);
        governance_token::set_governance_token_address(&env, &token);
    }
}

#[cfg(not(target_family = "wasm"))]
#[contractimpl]
impl NiffyInsure {
    pub fn test_seed_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        coverage: i128,
        end_ledger: u32,
    ) {
        use crate::types::{Policy, PolicyType, RegionTier, TerminationReason};
        let token = storage::get_token(&env);
        let policy = Policy {
            holder: holder.clone(),
            policy_id,
            policy_type: PolicyType::Auto,
            region: RegionTier::Medium,
            premium: 10_000_000,
            coverage,
            is_active: true,
            start_ledger: 1,
            end_ledger,
            asset: token,
            deductible: None,
            beneficiary: None,
            terminated_at_ledger: 0,
            termination_reason: TerminationReason::None,
            terminated_by_admin: false,
            strike_count: 0,
        };
        let key = storage::DataKey::Policy(holder.clone(), policy_id);
        env.storage().persistent().set(&key, &policy);
        env.storage().persistent().extend_ttl(
            &key,
            storage::PERSISTENT_TTL_THRESHOLD,
            storage::PERSISTENT_TTL_EXTEND_TO,
        );
        storage::add_voter(&env, &holder);
    }

    pub fn test_remove_voter(env: Env, holder: Address) {
        storage::remove_voter(&env, &holder);
    }

    /// Test-only: advance a seeded policy's end_ledger to simulate a renewal
    /// without going through token transfer. Mirrors what renew_policy does
    /// to the policy record after premium collection.
    pub fn test_renew_policy(env: Env, holder: Address, policy_id: u32) {
        let mut policy = storage::get_policy(&env, &holder, policy_id).expect("policy not found");
        let new_start = policy.end_ledger.saturating_add(1);
        let new_end = new_start + ledger::POLICY_DURATION_LEDGERS;
        policy.start_ledger = new_start;
        policy.end_ledger = new_end;
        storage::set_policy(&env, &holder, policy_id, &policy);
    }

    pub fn admin_set_open_claim_count(
        env: Env,
        admin: Address,
        holder: Address,
        policy_id: u32,
        open_claim_count: u32,
    ) {
        let expected = storage::get_admin(&env);
        admin.require_auth();
        assert!(admin == expected, "only admin can set open claim count");
        storage::set_open_claim(&env, &holder, policy_id, open_claim_count > 0);
    }
}
