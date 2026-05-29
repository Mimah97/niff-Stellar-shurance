#![cfg(test)]

use niffyinsure::{
    types::{
        AgeBand, Claim, ClaimEvidenceEntry, ClaimStatus, CoverageTier, Policy, PolicyType,
        RegionTier, RiskInput, TerminationReason, VoteOption, DETAILS_MAX_LEN, IMAGE_URLS_MAX,
        IMAGE_URL_MAX_LEN, REASON_MAX_LEN, SAFETY_SCORE_MAX,
    },
    validate::{
        check_claim_fields, check_claim_open, check_policy, check_policy_active, check_reason,
        check_risk_input, Error,
    },
};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String, Vec};

fn register_contract(env: &Env) -> Address {
    env.register(niffyinsure::NiffyInsure, ())
}

fn non_zero_hash(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[0] = 1;
    BytesN::from_array(env, &a)
}

fn zero_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn empty_evidence(env: &Env) -> Vec<ClaimEvidenceEntry> {
    Vec::new(env)
}

fn one_url_evidence(env: &Env, url: &str) -> Vec<ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    v.push_back(ClaimEvidenceEntry {
        url: String::from_str(env, url),
        hash: non_zero_hash(env),
    });
    v
}

fn dummy_policy(env: &Env, start: u32, end: u32, coverage: i128, active: bool) -> Policy {
    Policy {
        holder: Address::generate(env),
        policy_id: 1,
        policy_type: PolicyType::Auto,
        region: RegionTier::Medium,
        premium: 10_000_000,
        coverage,
        is_active: active,
        start_ledger: start,
        end_ledger: end,
        asset: Address::generate(env),
        deductible: None,
        beneficiary: None,
        terminated_at_ledger: 0,
        termination_reason: TerminationReason::None,
        terminated_by_admin: false,
        strike_count: 0,
    }
}

fn dummy_claim(env: &Env, amount: i128, status: ClaimStatus) -> Claim {
    Claim {
        claim_id: 1,
        policy_id: 1,
        claimant: Address::generate(env),
        amount,
        deductible: 0,
        asset: Address::generate(env),
        details: String::from_str(env, "fire damage"),
        evidence: empty_evidence(env),
        status,
        voting_deadline_ledger: 1_000,
        approve_votes: 0,
        reject_votes: 0,
        filed_at: 100,
        eligible_voter_count: 0,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: soroban_sdk::Vec::new(env),
    }
}

// ── Policy struct validation ──────────────────────────────────────────────────

#[test]
fn valid_policy_passes() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, true);
    assert_eq!(check_policy(&p), Ok(()));
}

#[test]
fn zero_coverage_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 0, true);
    assert_eq!(check_policy(&p), Err(Error::ZeroCoverage));
}

#[test]
fn negative_coverage_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, -1, true);
    assert_eq!(check_policy(&p), Err(Error::ZeroCoverage));
}

#[test]
fn inverted_ledger_window_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 200, 100, 50_000_000, true);
    assert_eq!(check_policy(&p), Err(Error::InvalidLedgerWindow));
}

#[test]
fn equal_ledger_window_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 100, 50_000_000, true);
    assert_eq!(check_policy(&p), Err(Error::InvalidLedgerWindow));
}

#[test]
fn deductible_within_coverage_passes() {
    let env = Env::default();
    let mut p = dummy_policy(&env, 100, 200, 50_000_000, true);
    p.deductible = Some(10_000_000);
    assert_eq!(check_policy(&p), Ok(()));
}

#[test]
fn deductible_exceeding_coverage_rejected() {
    let env = Env::default();
    let mut p = dummy_policy(&env, 100, 200, 50_000_000, true);
    p.deductible = Some(50_000_001);
    assert_eq!(check_policy(&p), Err(Error::Overflow));
}

#[test]
fn negative_deductible_rejected() {
    let env = Env::default();
    let mut p = dummy_policy(&env, 100, 200, 50_000_000, true);
    p.deductible = Some(-1);
    assert_eq!(check_policy(&p), Err(Error::Overflow));
}

// ── Policy active check ───────────────────────────────────────────────────────

#[test]
fn active_policy_within_window_passes() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, true);
    assert_eq!(check_policy_active(&p, 150), Ok(()));
}

#[test]
fn expired_policy_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, true);
    assert_eq!(check_policy_active(&p, 200), Err(Error::PolicyExpired));
    assert_eq!(check_policy_active(&p, 201), Err(Error::PolicyExpired));
}

#[test]
fn inactive_policy_rejected() {
    let env = Env::default();
    let p = dummy_policy(&env, 100, 200, 50_000_000, false);
    assert_eq!(check_policy_active(&p, 150), Err(Error::PolicyInactive));
}

// ── Claim field validation ────────────────────────────────────────────────────

#[test]
fn valid_claim_passes() {
    let env = Env::default();
    let cid = register_contract(&env);
    let details = String::from_str(&env, "roof collapsed");
    let ev = one_url_evidence(&env, "ipfs://Qm123");
    let result = env.as_contract(&cid, || {
        check_claim_fields(&env, 1_000_000, 50_000_000, &details, &ev)
    });
    assert_eq!(result, Ok(()));
}

#[test]
fn zero_claim_amount_rejected() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let ev = empty_evidence(&env);
    assert_eq!(
        check_claim_fields(&env, 0, 50_000_000, &details, &ev),
        Err(Error::ClaimAmountZero)
    );
}

#[test]
fn claim_exceeds_coverage_rejected() {
    let env = Env::default();
    let details = String::from_str(&env, "x");
    let ev = empty_evidence(&env);
    assert_eq!(
        check_claim_fields(&env, 60_000_000, 50_000_000, &details, &ev),
        Err(Error::ClaimExceedsCoverage)
    );
}

#[test]
fn claim_amount_equal_to_coverage_passes() {
    let env = Env::default();
    let cid = register_contract(&env);
    let details = String::from_str(&env, "x");
    let ev = empty_evidence(&env);
    let result = env.as_contract(&cid, || {
        check_claim_fields(&env, 50_000_000, 50_000_000, &details, &ev)
    });
    assert_eq!(result, Ok(()));
}

#[test]
fn details_at_max_len_passes() {
    let env = Env::default();
    let cid = register_contract(&env);
    let s: soroban_sdk::String = String::from_str(&env, &"a".repeat(DETAILS_MAX_LEN as usize));
    let ev = empty_evidence(&env);
    let result = env.as_contract(&cid, || check_claim_fields(&env, 1, 100, &s, &ev));
    assert_eq!(result, Ok(()));
}

#[test]
fn details_over_max_len_rejected() {
    let env = Env::default();
    let s = String::from_str(&env, &"a".repeat(DETAILS_MAX_LEN as usize + 1));
    let ev = empty_evidence(&env);
    assert_eq!(
        check_claim_fields(&env, 1, 100, &s, &ev),
        Err(Error::DetailsTooLong)
    );
}

#[test]
fn too_many_image_urls_rejected() {
    let env = Env::default();
    let cid = register_contract(&env);
    let details = String::from_str(&env, "x");
    let url = String::from_str(&env, "ipfs://Qm1");
    let mut ev = Vec::new(&env);
    for _ in 0..=IMAGE_URLS_MAX {
        ev.push_back(ClaimEvidenceEntry {
            url: url.clone(),
            hash: non_zero_hash(&env),
        });
    }
    let result = env.as_contract(&cid, || check_claim_fields(&env, 1, 100, &details, &ev));
    assert_eq!(result, Err(Error::TooManyImageUrls));
}

#[test]
fn image_url_over_max_len_rejected() {
    let env = Env::default();
    let cid = register_contract(&env);
    let details = String::from_str(&env, "x");
    let long_url = String::from_str(&env, &"u".repeat(IMAGE_URL_MAX_LEN as usize + 1));
    let mut ev = Vec::new(&env);
    ev.push_back(ClaimEvidenceEntry {
        url: long_url,
        hash: non_zero_hash(&env),
    });
    let result = env.as_contract(&cid, || check_claim_fields(&env, 1, 100, &details, &ev));
    assert_eq!(result, Err(Error::ImageUrlTooLong));
}

#[test]
fn evidence_sha256_all_zero_rejected() {
    let env = Env::default();
    let cid = register_contract(&env);
    let details = String::from_str(&env, "x");
    let mut ev = Vec::new(&env);
    ev.push_back(ClaimEvidenceEntry {
        url: String::from_str(&env, "ipfs://a"),
        hash: zero_hash(&env),
    });
    let result = env.as_contract(&cid, || check_claim_fields(&env, 1, 100, &details, &ev));
    assert_eq!(result, Err(Error::ExcessiveEvidenceBytes));
}

// ── Claim status / vote validation ───────────────────────────────────────────

#[test]
fn processing_claim_is_open() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Processing);
    assert_eq!(check_claim_open(&c), Ok(()));
}

#[test]
fn approved_claim_is_terminal() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Approved);
    assert_eq!(check_claim_open(&c), Err(Error::ClaimAlreadyTerminal));
}

#[test]
fn paid_claim_is_terminal() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Paid);
    assert_eq!(check_claim_open(&c), Err(Error::ClaimAlreadyTerminal));
}

#[test]
fn rejected_claim_is_terminal() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Rejected);
    assert_eq!(check_claim_open(&c), Err(Error::ClaimAlreadyTerminal));
}

#[test]
fn withdrawn_claim_is_terminal() {
    let env = Env::default();
    let c = dummy_claim(&env, 1_000_000, ClaimStatus::Withdrawn);
    assert_eq!(check_claim_open(&c), Err(Error::ClaimAlreadyTerminal));
}

// ── Enum coherence ────────────────────────────────────────────────────────────

#[test]
fn vote_option_variants_distinct() {
    assert_ne!(VoteOption::Approve, VoteOption::Reject);
}

#[test]
fn claim_status_terminal_flags() {
    assert!(!ClaimStatus::Pending.is_terminal());
    assert!(!ClaimStatus::Processing.is_terminal());
    assert!(ClaimStatus::Approved.is_terminal());
    assert!(ClaimStatus::Paid.is_terminal());
    assert!(ClaimStatus::Rejected.is_terminal());
    assert!(ClaimStatus::Withdrawn.is_terminal());
}

// ── image_url boundary (at max len passes) ────────────────────────────────────

#[test]
fn image_url_at_max_len_passes() {
    let env = Env::default();
    let cid = register_contract(&env);
    let details = String::from_str(&env, "x");
    let url_at_max = String::from_str(&env, &"u".repeat(IMAGE_URL_MAX_LEN as usize));
    let mut ev = Vec::new(&env);
    ev.push_back(ClaimEvidenceEntry {
        url: url_at_max,
        hash: non_zero_hash(&env),
    });
    let result = env.as_contract(&cid, || check_claim_fields(&env, 1, 100, &details, &ev));
    assert_eq!(result, Ok(()));
}

// ── safety_score boundary tests ───────────────────────────────────────────────

fn dummy_risk_input(safety_score: u32) -> RiskInput {
    RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score,
    }
}

#[test]
fn safety_score_zero_passes() {
    assert_eq!(check_risk_input(&dummy_risk_input(0)), Ok(()));
}

#[test]
fn safety_score_at_max_passes() {
    assert_eq!(
        check_risk_input(&dummy_risk_input(SAFETY_SCORE_MAX)),
        Ok(())
    );
}

#[test]
fn safety_score_over_max_rejected() {
    assert_eq!(
        check_risk_input(&dummy_risk_input(SAFETY_SCORE_MAX + 1)),
        Err(Error::SafetyScoreOutOfRange)
    );
}

// ── reason length boundary tests ──────────────────────────────────────────────

#[test]
fn reason_at_max_len_passes() {
    let env = Env::default();
    let r = String::from_str(&env, &"r".repeat(REASON_MAX_LEN as usize));
    assert_eq!(check_reason(&r), Ok(()));
}

#[test]
fn reason_over_max_len_rejected() {
    let env = Env::default();
    let r = String::from_str(&env, &"r".repeat(REASON_MAX_LEN as usize + 1));
    assert_eq!(check_reason(&r), Err(Error::ReasonTooLong));
}

#[test]
fn reason_empty_passes() {
    let env = Env::default();
    let r = String::from_str(&env, "");
    assert_eq!(check_reason(&r), Ok(()));
}

// ── details boundary (empty passes) ──────────────────────────────────────────

#[test]
fn details_empty_passes() {
    let env = Env::default();
    let cid = register_contract(&env);
    let s = String::from_str(&env, "");
    let ev = empty_evidence(&env);
    let result = env.as_contract(&cid, || check_claim_fields(&env, 1, 100, &s, &ev));
    assert_eq!(result, Ok(()));
}

// ── evidence count at max passes ──────────────────────────────────────────────

#[test]
fn evidence_at_max_count_passes() {
    let env = Env::default();
    let cid = register_contract(&env);
    let details = String::from_str(&env, "x");
    let url = String::from_str(&env, "ipfs://Qm1");
    let mut ev = Vec::new(&env);
    for _ in 0..IMAGE_URLS_MAX {
        ev.push_back(ClaimEvidenceEntry {
            url: url.clone(),
            hash: non_zero_hash(&env),
        });
    }
    let result = env.as_contract(&cid, || check_claim_fields(&env, 1, 100, &details, &ev));
    assert_eq!(result, Ok(()));
}
