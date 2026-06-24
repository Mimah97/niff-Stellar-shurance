# Stellar Testnet Reset Recovery Runbook

**Owner:** Platform Engineering  
**Primary responders:** Backend on-call, Contracts team  
**Review cadence:** After every Stellar testnet reset; quarterly otherwise  
**Scope:** Testnet only — this procedure does NOT apply to mainnet or futurenet

---

## Background

The Stellar Development Foundation periodically resets the testnet ledger, wiping all account balances, contracts, and ledger history back to ledger 1. When a reset occurs:

- All deployed Soroban contracts are destroyed (contract IDs become invalid)
- All test accounts lose their XLM balances
- Horizon and Soroban RPC history is truncated to ledger 1
- The indexer cursors stored in PostgreSQL reference ledgers that no longer exist
- `contracts/deployment-registry.json` references stale contract IDs and WASM hashes

Official reset schedule is announced at [Stellar Developer Discord](https://discord.gg/stellardev) and the [Stellar Status page](https://status.stellar.org). Resets typically occur quarterly.

---

## Detection

A testnet reset can be detected by any of the following signals:

- Soroban RPC returns `ledger not found` or ledger numbers roll back to near 0
- `GET /api/v1/health` returns errors referencing the indexer or contract
- The indexer logs `CONTRACT_NOT_FOUND` or `startLedger out of range`
- Stellar explorer shows current ledger near 1 while our `ledger_cursors` table holds a much higher value
- Horizon returns `404` for previously-valid account IDs

Confirm with:

```bash
curl $SOROBAN_RPC_URL -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}'
# If sequence is near 1, a reset has occurred.

psql $DATABASE_URL -Atqc "SELECT network, last_processed_ledger FROM ledger_cursors ORDER BY network;"
# Compare with the RPC sequence above — if DB value >> RPC value, reset is confirmed.
```

---

## Step-by-step Recovery Procedure

### 1. Declare the incident

Owner: Incident Commander

1. Post in `#incidents`: testnet reset confirmed, backend indexer stopped, testnet unusable.
2. Freeze all testnet deployments and non-essential testnet work until recovery completes.
3. Open a recovery ticket using [`recovery-drill-ticket-template.md`](./recovery-drill-ticket-template.md), annotating it as "testnet reset" rather than a disaster.

---

### 2. Stop the indexer

Owner: Backend on-call

Stop the indexer before making any database or contract changes to avoid conflicting state.

```bash
# Kubernetes
kubectl scale deployment niffyinsure-indexer --replicas=0 -n staging

# Docker Compose
docker compose stop indexer
```

---

### 3. Fund test accounts

Owner: Contracts team

All testnet accounts need fresh XLM after a reset. Use Friendbot to fund each required account:

```bash
# Fund the admin / upgrade keypair
curl "https://friendbot.stellar.org?addr=<ADMIN_PUBLIC_KEY>"

# Fund any additional test wallets used in CI or seeding
curl "https://friendbot.stellar.org?addr=<TEST_WALLET_1>"
curl "https://friendbot.stellar.org?addr=<TEST_WALLET_2>"
```

Verify balances on Horizon:

```bash
curl "$HORIZON_URL/accounts/<ADMIN_PUBLIC_KEY>" | python3 -m json.tool | grep balance
```

---

### 4. Rebuild and deploy contracts

Owner: Contracts team

All Soroban contracts must be re-uploaded and re-instantiated because their on-chain state is gone.

**4a. Build the WASM**

```bash
cargo build --release --target wasm32-unknown-unknown
sha256sum target/wasm32-unknown-unknown/release/niffyinsure.wasm
# Record the hash as NEW_WASM_HASH
```

**4b. Upload the WASM**

```bash
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/niffyinsure.wasm \
  --source <ADMIN_KEYPAIR_ALIAS> \
  --network testnet
# Note the returned WASM hash — must match NEW_WASM_HASH
```

**4c. Deploy a fresh contract instance**

```bash
stellar contract deploy \
  --wasm-hash <NEW_WASM_HASH> \
  --source <ADMIN_KEYPAIR_ALIAS> \
  --network testnet
# Note the returned CONTRACT_ID as NEW_CONTRACT_ID
```

**4d. Initialise the contract**

Run the contract's initialisation entrypoint with the required constructor arguments (treasury, admin, token, etc.). Refer to `contracts/niffyinsure/README.md` for the init parameters.

```bash
stellar contract invoke \
  --id <NEW_CONTRACT_ID> \
  --source <ADMIN_KEYPAIR_ALIAS> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_PUBLIC_KEY> \
  --token <TOKEN_CONTRACT_ID> \
  <...other init args>
```

---

### 5. Update `contracts/deployment-registry.json`

Owner: Contracts team

Update the `testnet` section with the new contract ID, WASM hash, and deployment timestamp.

```json
// contracts/deployment-registry.json — testnet section
{
  "name": "niffyinsure",
  "contractId": "<NEW_CONTRACT_ID>",
  "expectedWasmHash": "<NEW_WASM_HASH>",
  "expectedVersion": "<NIFFYINSURE_EXPECTED_VERSION>",
  "deployedVersion": "<version string from get_version() call>",
  "deployedAt": "<ISO_TIMESTAMP>",
  "notes": "Testnet deployment after testnet reset on <RESET_DATE>."
}
```

Commit this change to a branch and open a PR so the registry is updated in source control before any CI uses the new IDs.

---

### 6. Update environment variables and secrets

Owner: Backend on-call

Update the testnet deployment's environment variables to reference the new contract ID and WASM hash:

| Variable | Action |
|---|---|
| `CONTRACT_ID_TESTNET` | Set to `<NEW_CONTRACT_ID>` |
| `NIFFYINSURE_EXPECTED_WASM_HASH` | Set to `<NEW_WASM_HASH>` |

Update in the secrets manager (AWS Secrets Manager / GitHub Actions secrets / `.env.local` for local development):

```bash
# AWS Secrets Manager example
aws secretsmanager update-secret \
  --secret-id CONTRACT_ID_TESTNET \
  --secret-string "<NEW_CONTRACT_ID>"

aws secretsmanager update-secret \
  --secret-id NIFFYINSURE_EXPECTED_WASM_HASH \
  --secret-string "<NEW_WASM_HASH>"
```

---

### 7. Reset the indexer cursor in PostgreSQL

Owner: Backend on-call

The stored `last_processed_ledger` values reference the old (now-invalid) ledger history. Reset them to ledger 0 (or to the contract deployment ledger) so the indexer starts from the correct point on the new chain.

```bash
# Identify the deployment ledger from the Soroban RPC (use the ledger at deploy time)
# If unknown, use 0 to replay from genesis — safe but slow.
export DEPLOY_LEDGER=<LEDGER_AT_DEPLOY_TIME>

psql $DATABASE_URL -v ON_ERROR_STOP=1 -c "
  UPDATE ledger_cursors
  SET last_processed_ledger = $DEPLOY_LEDGER, updated_at = NOW()
  WHERE network = 'testnet';
"
```

If the `ledger_cursors` row does not exist yet (fresh DB), the indexer will create it on first start.

**Purge stale derived data (optional but recommended):**

If the database still contains `raw_events`, `claims`, or `policies` rows from the old chain, clear them to avoid phantom state:

```bash
psql $DATABASE_URL -v ON_ERROR_STOP=1 -c "
  DELETE FROM raw_events WHERE TRUE;
  -- Cascade-delete claims and policies only if they were seeded from the old chain
  -- and not from real test scenarios you wish to preserve.
"
```

> **Warning:** Deleting `raw_events` and derived rows is irreversible. Only do this after confirming there is no production-equivalent data worth preserving. On testnet, all data is synthetic, so a full clear is usually correct.

---

### 8. Re-seed test data

Owner: Backend on-call / QA

After the contracts are deployed and the DB is cleared, re-run the test data seed script to populate the testnet environment with representative policies and claims for CI and manual testing:

```bash
cd backend
npm run seed
```

If the seed script requires environment-specific overrides (contract ID, test wallet addresses), ensure these are set correctly before running:

```bash
export STELLAR_NETWORK=testnet
export CONTRACT_ID=$CONTRACT_ID_TESTNET
npm run seed
```

Verify that seed data appears on-chain and in the DB:

```bash
psql $DATABASE_URL -Atqc "SELECT COUNT(*) FROM policies;"
psql $DATABASE_URL -Atqc "SELECT COUNT(*) FROM claims;"
```

---

### 9. Restart the indexer

Owner: Backend on-call

```bash
# Kubernetes
kubectl scale deployment niffyinsure-indexer --replicas=1 -n staging

# Docker Compose
docker compose start indexer
```

Monitor catch-up progress:

```bash
watch -n 5 'psql $DATABASE_URL -Atqc "SELECT last_processed_ledger, updated_at FROM ledger_cursors WHERE network = '"'"'testnet'"'"';"'

# Check lag metric
curl http://localhost:3000/metrics | grep indexer_lag_ledgers
```

Alert threshold: `indexer_lag_ledgers > 500` → investigate RPC latency or increase `INDEXER_BATCH_SIZE`.

---

### 10. Verify WASM drift check

Owner: Backend on-call

Trigger a wasm drift check to confirm the deployment registry now matches the on-chain state:

```bash
curl -X POST https://staging-api.example.com/admin/maintenance/check-wasm-drift \
  -H "Authorization: Bearer $ADMIN_JWT"
# Expected: no drift alert
```

Resolve any stale drift alerts from the old contract:

```sql
UPDATE wasm_drift_alerts
SET resolved_at = NOW()
WHERE contract_name = 'niffyinsure' AND resolved_at IS NULL;
```

---

### 11. Smoke test

Owner: Backend on-call

Run the end-to-end smoke tests against the testnet environment to confirm the full user flow is functional:

```bash
cd backend
STELLAR_NETWORK=testnet npm run test:e2e:ci
```

Manual spot-checks:

- Submit a new quote → confirm it processes and policy is created
- File a test claim → confirm it appears in the indexer
- `/api/v1/health` returns `200 OK` with all subsystems healthy

---

### 12. Update CI secrets

Owner: Platform Engineering

If CI pipelines use `CONTRACT_ID_TESTNET` or `NIFFYINSURE_EXPECTED_WASM_HASH` as GitHub Actions secrets, update them in the repository settings:

1. Go to **Repository → Settings → Secrets and variables → Actions**.
2. Update `CONTRACT_ID_TESTNET` to `<NEW_CONTRACT_ID>`.
3. Update `NIFFYINSURE_EXPECTED_WASM_HASH` to `<NEW_WASM_HASH>`.
4. Re-run any failed CI runs that referenced the old contract.

---

### 13. Close the incident and record the recovery

Owner: Incident Commander

1. Confirm all subsystems are healthy.
2. Unfreeze testnet deployments.
3. Record the recovery in [`recovery-drill-log.md`](./recovery-drill-log.md) with:
   - Date of reset
   - New contract ID
   - New WASM hash
   - Deployment ledger
   - Recovery start/end timestamps and duration
   - Any gaps or issues encountered
4. Close the incident ticket.
5. Open follow-up issues for any automation improvements (e.g., auto-detect reset via ledger sequence monitoring, auto-reseed CI on reset).

---

## Quick-reference checklist

- [ ] Testnet reset confirmed via RPC ledger sequence
- [ ] Incident declared; testnet deploys frozen
- [ ] Indexer stopped
- [ ] Test accounts funded via Friendbot
- [ ] WASM built, uploaded, and contract deployed
- [ ] `contracts/deployment-registry.json` updated and PR merged
- [ ] `CONTRACT_ID_TESTNET` and `NIFFYINSURE_EXPECTED_WASM_HASH` secrets updated
- [ ] `ledger_cursors` reset to deploy ledger
- [ ] Stale `raw_events` / derived data cleared (if applicable)
- [ ] Test data re-seeded (`npm run seed`)
- [ ] Indexer restarted and catch-up monitored
- [ ] Wasm drift check returns clean
- [ ] Smoke tests pass
- [ ] CI secrets updated
- [ ] Recovery logged in `recovery-drill-log.md`
- [ ] Incident closed; testnet deploys unfrozen

---

## Environment variables affected

| Variable | Change required |
|---|---|
| `CONTRACT_ID_TESTNET` | New contract ID from fresh deploy |
| `NIFFYINSURE_EXPECTED_WASM_HASH` | SHA-256 of newly-uploaded WASM |
| `STELLAR_NETWORK` | Must remain `testnet` |
| `SOROBAN_RPC_URL` / `SOROBAN_RPC_URL_TESTNET` | No change — same RPC endpoint |
| `HORIZON_URL` / `HORIZON_URL_TESTNET` | No change — same Horizon endpoint |

---

## Related runbooks

- [Disaster Recovery Runbook](./disaster-recovery-runbook.md) — PostgreSQL restore, Redis loss, RTO/RPO
- [Operational Maintenance Runbook](./maintenance-runbook.md) — WASM drift, contract upgrades, indexer reindex
- [Secrets Management Runbook](./secrets-management-runbook.md) — Secret rotation and storage
