# Staging Data Sync Schedule

This document describes how production data is anonymized and loaded into the
staging environment, and the schedule on which the sync runs.

## Overview

Staging is refreshed from a production snapshot on a fixed schedule. Before any
production data reaches staging it passes through an anonymization step so that
no personally identifiable information (PII) or secrets are copied.

## Schedule

| Job | Cadence | Window (UTC) | Notes |
| --- | --- | --- | --- |
| Production snapshot | Daily | 02:00 | Read-only logical dump |
| Anonymize + load into staging | Daily | 02:30 | Runs after snapshot completes |
| Full re-seed (drop + reload) | Weekly (Sun) | 03:00 | Rebuilds staging from scratch |

Jobs are skipped automatically if a previous run is still in progress.

## Anonymization rules

The following transformations are applied to the production snapshot before it
is loaded into staging. Rules are applied in order and are idempotent.

| Table / field | Rule |
| --- | --- |
| `users.email` | Replace with `user+<id>@example.invalid` |
| `users.phone` | Replace with a deterministic fake number |
| `users.name` | Replace with `Staging User <id>` |
| `users.password_hash` | Replace with a fixed bcrypt hash of a known staging password |
| `users.wallet_address` | Replace with a deterministic testnet address |
| `sessions.*` | Drop all rows |
| `api_keys.*` | Drop all rows |
| `payments.*` | Keep amounts and statuses; drop external references and provider payloads |
| `webhooks.*` | Drop all rows |
| Any column matching `*_secret`, `*_token`, `*_key` | Replace with `REDACTED` |

### Guarantees

- No production credentials, tokens, or secrets are copied.
- No real email addresses, phone numbers, or wallet addresses remain.
- Row counts and referential integrity are preserved so staging behaves like
  production for testing purposes.

## Running the sync manually

The sync is normally triggered by the scheduler, but can be run on demand:

```sh
# from the repository root
./scripts/staging-sync.sh
```

The script performs the snapshot, applies the anonymization rules above, and
loads the result into the staging database. It is safe to re-run.

## Failure handling

- If anonymization fails, the load is aborted and staging is left untouched.
- Failures are reported to the `#staging` channel and the on-call engineer.
- A failed run does not advance the schedule; the next run retries normally.
