# Security Policy — NiffyInsur

## Scope

This policy covers:

- **Smart contracts** (`contracts/niffyinsure`, `contracts/premium_calculator`) — Stellar Soroban WASM
- **Backend API** (`backend/`) — NestJS/Prisma service
- **Frontend** (`frontend/`) — Next.js web application

## Threat Model

### Smart Contract Threats

| ID | Threat | Control |
|----|--------|---------|
| AUTH-01 | Non-admin invokes privileged entrypoints | Stored admin `require_auth`; negative auth tests |
| AUTH-02 | Admin rotation hijacked by unrelated signer | Pending admin must `accept_admin` with its own auth |
| AUTH-03 | Contract initialized twice | Initialization guard reverts on re-init |
| AUTH-04 | Admin proposal lifecycle abuse (self-confirm, replay, expiry bypass) | `CannotSelfConfirm` guard; expiry clears state and reverts |
| TOKEN-01 | Invalid token movement (zero/negative drain or sweep amounts) | Input validation before any transfer |
| TOKEN-02 | Non-admin drains or sweeps funds | Admin auth + allowlist checks |
| TOKEN-03 | Payout uses wrong asset | Policy-bound asset enforced at payout |
| CLAIM-01 | Claim amount exceeds coverage or deductible rules | Claim validation and deductible tests |
| VOTE-01 | Ineligible or duplicate voter alters outcome | Active-policy eligibility, snapshot TTL, duplicate vote guard |
| GOV-01 | Quorum or duration config produces unsafe values | Bounded admin setters with minimum/maximum guards |
| OPS-01 | Pause/unpause masks critical code paths | Granular pause flag; tested positive and negative paths |
| FUZZ-01 | Malformed entrypoint inputs cause panic or overflow | cargo-fuzz targets for `file_claim`, `initiate_policy`, `finalize_claim` |

### Backend / API Threats

| ID | Threat | Control |
|----|--------|---------|
| API-01 | Unauthenticated access to admin endpoints | JWT role check (`role === 'admin'`) on all `/admin/*` routes |
| API-02 | Replay or forged JWT | Short-lived tokens; signature verified server-side |
| API-03 | Mass enumeration of claims or policies | Keyset pagination; rate-limiting on public endpoints |
| API-04 | Support ticket / contact form spam | CAPTCHA verification + IP-rate-limit (5 requests / 10 min) |
| API-05 | Sensitive data leakage via logs | IP addresses are SHA-256 hashed before storage; no raw PII in logs |
| API-06 | SQL injection | Prisma parameterized queries; no raw SQL with user input |

### Frontend Threats

| ID | Threat | Control |
|----|--------|---------|
| FE-01 | XSS via claim details or FAQ content | React escaping; no `dangerouslySetInnerHTML` with user input |
| FE-02 | Session token leakage | JWT stored in memory, not `localStorage` |
| FE-03 | CSRF on mutating API calls | Authenticated requests include the JWT bearer token |

## Two-Step Admin Operations

High-risk operations require **two separate signers** to execute. A single admin key cannot complete these operations alone.

### Protected Operations

| Operation | Step 1 | Step 2 |
|-----------|--------|--------|
| Treasury rotation | `propose_admin_action(AdminAction::treasury_rotation(new_treasury))` | `confirm_admin_action(confirmer)` — confirmer ≠ proposer |
| Token sweep | `propose_admin_action(AdminAction::token_sweep(asset, recipient, amount, reason_code))` | `confirm_admin_action(confirmer)` — confirmer ≠ proposer |
| Admin key rotation | `propose_admin(new_admin)` | `accept_admin()` — called by new admin key |

### How the Two-Step Flow Works

1. **Proposer** — current admin calls `propose_admin_action`. Stores `PendingAdminAction { proposer, action, expiry_ledger }` and emits `AdminActionProposed`.
2. **Confirmer** — a *different* address calls `confirm_admin_action(confirmer)`. The `CannotSelfConfirm` guard reverts if `confirmer == proposer`. On success the action executes and `AdminActionConfirmed` is emitted.
3. **Expiry** — if `confirm_admin_action` is called after `expiry_ledger`, the pending entry is cleared, `AdminActionExpired` is emitted, and the call reverts. Expired proposals are inert and cannot be replayed.
4. **Cancellation** — the proposer (current admin) may call `cancel_admin_action` at any time before expiry to withdraw the proposal.

**Configurable window:** `AdminActionWindowLedgers` (default 100 ledgers ≈ 8 minutes at 5 s/ledger).

### Production Multisig Recommendation

- **Admin key**: 3-of-5 Stellar multisig.
- **Proposer role**: hot key (online, lower threshold).
- **Confirmer role**: cold key (offline, higher threshold).
- **Recovery**: documented in the ops runbook.

## Responsible Disclosure

If you discover a security vulnerability, **do not open a public GitHub issue**. Report it privately so we can coordinate a fix before disclosure.

### How to Report

1. **Email**: security@niffyinsur.com  
   Encrypt with our PGP key (fingerprint published at [niffyinsur.com/security](https://niffyinsur.com/security)).
2. **GitHub private vulnerability reporting**: Use the "Report a vulnerability" button in the Security tab of this repository.

### What to Include

- A concise description of the vulnerability and its impact.
- Steps to reproduce or a proof-of-concept (does not need to be weaponised).
- Affected component(s) and version or commit hash.
- Your preferred contact method for follow-up questions.

### Response Commitments

| Milestone | Target |
|-----------|--------|
| Acknowledgement | Within 2 business days |
| Triage and severity classification | Within 5 business days |
| Fix or mitigation plan communicated | Within 14 business days for Critical/High; 30 days for Medium/Low |
| Public disclosure (coordinated) | After fix is deployed and verified |

We ask researchers to keep the issue confidential until we have confirmed a fix is available.

## Severity Classification

We follow a CVSS-inspired scale:

| Severity | CVSS Range | Description | Example |
|----------|-----------|-------------|---------|
| **Critical** | 9.0–10.0 | Direct theft of funds or permanent loss of user assets | Bypassing admin auth on `drain`; exploiting `confirm_admin_action` self-confirmation |
| **High** | 7.0–8.9 | Significant economic impact, data breach of PII, or complete DoS | Claim payout manipulation; JWT forgery granting admin access |
| **Medium** | 4.0–6.9 | Limited impact or hard-to-exploit path | Information disclosure of non-sensitive data; partial DoS |
| **Low** | 0.1–3.9 | Theoretical risk, minimal real-world impact | Minor information leakage; UI-only issues without auth bypass |
| **Informational** | N/A | Best-practice recommendation with no immediate risk | Outdated dependency with no known exploit |

## Bug Bounty

A formal bug bounty program has not yet launched. Researchers who responsibly disclose Critical or High severity issues will be acknowledged in our Hall of Thanks (with permission) and considered for discretionary rewards at our sole discretion.

## Out of Scope

The following are explicitly **out of scope**:

- Attacks requiring physical access to a device or social engineering of staff.
- Issues in third-party dependencies that have a published CVE and are on our update backlog.
- Self-XSS or attacks that require the victim to execute code in their own browser console.
- Rate-limit bypasses that do not enable further exploitation.
- Issues in test or development infrastructure not reachable from production.
- On-chain data that is public by nature (all Stellar ledger data is publicly visible).

## Contact

| Channel | Address |
|---------|---------|
| Security disclosures | security@niffyinsur.com |
| General enquiries | hello@niffyinsur.com |
| GitHub | [InsurNiffy/niff-Stellar-shurance](https://github.com/InsurNiffy/niff-Stellar-shurance) |
