# Block 3 — Curl Verification Matrix

Verification record for Block 3 (connector framework). Run on the preview deploy `https://block-3-connector-framework.elinno-agent.pages.dev` (commit `2f869b8` on branch `block-3-connector-framework`, redeployed via dashboard "Retry deployment" so that `MASTER_ENCRYPTION_KEY` and `ALLOW_CRYPTO_SMOKE` were bound at build time).

## Pre-flight (Phase A — Jenny's hands)

| Step | Action | Verified |
|---|---|---|
| Schema migration | `db/migrations/2026-05-04-encryption-algorithm-v1.sql` applied via Neon SQL Editor | `column_default = 'aes-256-gcm-v1'::text` |
| `MASTER_ENCRYPTION_KEY` (Production) | `wrangler pages secret put` | `Success! Uploaded secret MASTER_ENCRYPTION_KEY` (production) |
| `MASTER_ENCRYPTION_KEY` (Preview) | `wrangler pages secret put --env=preview` (different value from production) | `Success! Uploaded secret MASTER_ENCRYPTION_KEY` (preview) |
| `ALLOW_CRYPTO_SMOKE=true` (Preview only) | `echo -n true \| wrangler pages secret put ALLOW_CRYPTO_SMOKE --env=preview` | `Success! Uploaded secret ALLOW_CRYPTO_SMOKE` |
| Preview redeploy | Cloudflare dashboard → Deployments → Retry on `2f869b8` so secrets bind | `Success: Your site was deployed!` |

## Phase B — Crypto smoke (`/api/crypto-roundtrip` on preview)

```json
{
  "ok": true,
  "checks": {
    "encrypt_returned_shape": true,
    "algorithm_tag": "aes-256-gcm-v1",
    "algorithm_tag_matches": true,
    "wrapped_data_key_length": 60,
    "iv_length": 12,
    "ciphertext_length": 66,
    "ciphertext_is_not_plaintext": true,
    "roundtrip_matches": true,
    "aad_tampering_detected": true
  }
}
```

All checks **PASS** (production check post-merge: must return `404 Not Found`, gate fails closed).

## Phase C — Fixtures

- Jenny (D1 `user_id=1`, workspace admin) — cookie at `/tmp/block3-jenny-cookie.txt`
- Bob (`bob+block3@example.com`, D1 `user_id=10`, NOT workspace admin, member of P3a only) — cookie at `/tmp/block3-bob-cookie.txt`
- P3a = `03829f71-1f8e-4573-bae8-a52571d9f6be` (Jenny admin, Bob member)
- P3b = `13414356-b8df-4f7c-aa3a-20c8f61b85b9` (Jenny admin, Bob NOT a member)
- C1 = `ab929550-06bc-40f5-9acb-65f67f0c8bc9` (the dummy connection on P3a; soft-deleted at end of S14)
- C2 = `4fb9cc59-23a7-4e57-9f40-b4b2d5171d2f` (second dummy on P3a, created by S20's display_name fallback test)

## Phase C — Matrix

| # | Scenario | Method + URL | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1a | No session: POST `/connections` | POST `$BASE/api/projects/$P/connections` (no cookie) | 401 + `{"error":"Not authenticated"}` | 401 + `{"error":"Not authenticated"}` | **PASS** |
| 1b | No session: GET `/connections` | GET (no cookie) | 401 | 401 | **PASS** |
| 1c | No session: DELETE `/connections/:id` | DELETE (no cookie) | 401 | 401 | **PASS** |
| 1d | No session: POST `/sync` | POST (no cookie) | 401 | 401 | **PASS** |
| 1e | No session: GET `/sync-runs` | GET (no cookie) | 401 | 401 | **PASS** |
| 2 | Bob POST `/connections` on P3a (member, not admin) | POST as Bob | 403 + `{"error":"Forbidden"}` | 403 + `{"error":"Forbidden"}` | **PASS** |
| 3 | Bob POST `/connections` on P3b (not a member) | POST as Bob | 403 + `Forbidden` | 403 + `Forbidden` | **PASS** |
| 4 | Bob GET `/connections` on P3a (member, listing allowed) | GET as Bob | 200, list visible | 200, list contains C1 | **PASS** |
| 5a | Bob DELETE `/connections/:id` (member, not admin) | DELETE as Bob | 403 | 403 | **PASS** |
| 5b | Bob POST `/sync` (member, not admin) | POST as Bob | 403 | 403 | **PASS** |
| 6 | Bob GET `/connections` on P3b (cross-project leakage) | GET as Bob | 403 | 403 | **PASS** |
| 7 | Jenny POST `/connections` happy path | POST `{"source":"dummy"}` as Jenny | 201, **whitelist enforced** (no `wrapped_data_key`/`iv`/`ciphertext_credentials`/`encryption_algorithm`/`credential_metadata`) | 201, response contains only `id, project_id, source, display_name="Dummy Connector", external_account_id="dummy-93495a73-b91", status="active", status_reason=null, last_sync_at=null, created_at, updated_at` | **PASS** — whitelist intact |
| 8 | Jenny GET `/connections` lists C1 | GET as Jenny | 200, list contains C1, whitelisted columns only | 200, single-row list with C1, whitelisted columns only | **PASS** |
| 9 | Jenny first sync — 3 inserts | POST `/sync` as Jenny | 200, status='succeeded', records_inserted=3, records_updated=0 | `{"status":"succeeded","records_inserted":3,"records_updated":0,"records_skipped":0,"error":null}` | **PASS** |
| 10 | Direct SQL — entities count for C1 | Neon: `SELECT COUNT(*) FROM entities WHERE connection_id = C1` | 3 | `entity_count = 3` | **PASS** |
| 11 | Jenny re-sync — idempotency | POST `/sync` as Jenny | 200, status='succeeded', records_inserted=0, records_updated=3 | `{"status":"succeeded","records_inserted":0,"records_updated":3,"records_skipped":0,"error":null}` | **PASS** — `xmax = 0` upsert split works |
| 12 | Direct SQL — entities count unchanged after re-sync | Neon: same query as S10 | 3 (unchanged) | `entity_count = 3` | **PASS** — UPSERT on `(connection_id, source_type, source_id)` |
| 13 | Jenny GET `/sync-runs` | GET as Jenny | 200, 2 runs, whitelist (no `detail` JSONB) | 200, 2 runs in reverse-chronological order, no `detail` column in response | **PASS** |
| 14a | Jenny DELETE C1 | DELETE as Jenny | 200 + `{"ok":true}` | 200 + `{"ok":true}` | **PASS** |
| 14b | After delete: GET `/connections` excludes C1 | GET as Jenny | C1 NOT in list | List contains only C2 (from S20); C1 absent | **PASS** |
| 14c | Direct SQL — `deleted_at` is NOT NULL | Neon: `SELECT deleted_at FROM connections WHERE id=C1` | timestamp value | `deleted_at = 2026-05-04 13:15:32.010639+00` | **PASS** |
| 14d | After delete: POST `/sync` on C1 | POST as Jenny | 4xx | `404 + {"error":"Not Found"}` (per-handler `deleted_at IS NULL` filter; project gate passed since Jenny owns P3a) | **PASS** |
| 15 | Plaintext-leak guard (silent failure mode) | Neon: hex-encode `ciphertext_credentials` for C1; assert NOT `0x7b7d` (UTF-8 of `{}`) | bytes ≠ `7b7d` | `ciphertext_hex = 307f129f860a13425c66abebd351f87d5f61` (18 bytes); first byte `0x30`, NOT `0x7b` | **PASS** — ciphertext is opaque |
| 15-extras | Envelope shape per v1 spec | `length(wrapped_data_key)=60` (12 IV + 32 wrapped DEK + 16 GCM tag), `length(iv)=12`, `length(ciphertext_credentials)=18` (`{}` 2 bytes + 16-byte GCM tag) | as expected | wrapped_dek_len=60, iv_len=12, ciphertext_len=18 | **PASS** — envelope shapes match the v1 spec exactly |
| 16 | AAD-tampering detection (silent failure mode) | Helper-layer test via `/api/crypto-roundtrip` (Phase B): encrypt with AAD₁; decrypt with tampered AAD (different `project_id`) MUST throw | `aad_tampering_detected: true` | `aad_tampering_detected: true` (Phase B JSON above) | **COMPOSITE PASS** — see note below |
| 17 | Algorithm-tag check (silent failure mode) | Neon: `SELECT encryption_algorithm FROM connections WHERE id=C1` | `'aes-256-gcm-v1'` exact | `encryption_algorithm = aes-256-gcm-v1` | **PASS** |
| 18 | Validation: unknown source | POST `{"source":"unknown_source"}` as Jenny | 400, verbatim | 400 + `{"error":"Unknown connector source: unknown_source"}` | **PASS** |
| 19 | Validation: missing source | POST `{}` as Jenny | 400, verbatim | 400 + `{"error":"source is required"}` | **PASS** |
| 20 | Validation: whitespace `display_name` falls back to default | POST `{"source":"dummy","display_name":"   "}` as Jenny | 201, `display_name = "Dummy Connector"` | 201, `display_name = "Dummy Connector"` | **PASS** |
| 21 | Validation: malformed JSON | POST raw `not json` as Jenny | 400, verbatim `Invalid JSON` | 400 + `{"error":"Invalid JSON"}` | **PASS** |
| 22 | 23505 reconnect (same `(project_id, source, external_account_id, deleted_at=NULL)` triple) | Schema constraint `UNIQUE NULLS NOT DISTINCT (project_id, source, external_account_id, deleted_at)` | not API-reachable: API generates random `external_account_id` per connect | constraint exists in schema-postgres.sql:220; verified by inspection only | **PASS-by-inspection** — see note below |

## Notes

### Scenario 16 — composite pass

BLOCK_3_PLAN's design intent for scenario 16 was a data-path AAD-tampering test: tamper `project_id` on a stored connection row via direct SQL, then trigger a decrypt-requiring API call (`/sync` or `testConnection`) and assert it fails. **In practice the dummy connector's `fullSync` does not call `decrypt`** — it upserts hardcoded fixture entities directly. The sync handler also does not call `testConnection` before `fullSync`. So a tampered row will pass through `/sync` without exercising the AAD verification.

The smoke endpoint at `/api/crypto-roundtrip` exercises the same security property at the helper layer: encrypt with `aadFor(connection_a)`, then decrypt with `aadFor(connection_b)` (different `project_id`) and assert the decrypt throws. The Phase B JSON shows `aad_tampering_detected: true` — the helper rejects mismatched AAD.

**Block 4** (Slack connector) will introduce the first connector whose sync does decrypt (it needs the OAuth token to call the Slack API). That block is the natural place for the data-path version of scenario 16. Carry-over follow-up is logged in HANDOFF.

### Scenario 22 — pass-by-inspection

The schema constraint `UNIQUE NULLS NOT DISTINCT (project_id, source, external_account_id, deleted_at)` ([db/schema-postgres.sql:220](db/schema-postgres.sql#L220)) prevents two active connections from sharing `(project_id, source, external_account_id)`. The dummy connector generates a random `external_account_id` on every connect (`dummy-${randomUUID().slice(0, 12)}`) by design (decision M), so the API path never collides — every reconnect produces a new `external_account_id`. The constraint will fire when:
- A real OAuth connector reconnects the same external workspace/account (e.g., Slack, same `team.id`, same project), OR
- A future direct SQL test deliberately INSERTs duplicate `external_account_id` values.

Both are deferred. Schema-level confirmation suffices for v1.1 dummy.

### Test data left on Neon

The matrix run created production rows that the API doesn't auto-clean. **Cleanup SQL (Jenny applies via Neon SQL Editor):**

```sql
-- Soft-delete the two test projects. FK ON DELETE CASCADE handles
-- connections + entities + project_members on hard delete; soft-delete
-- preserves the rows but the requireProjectRole 'deleted_at IS NULL'
-- filter removes them from every project-scoped query.
UPDATE projects
   SET deleted_at = NOW()
 WHERE id IN (
    '03829f71-1f8e-4573-bae8-a52571d9f6be',  -- P3a
    '13414356-b8df-4f7c-aa3a-20c8f61b85b9'   -- P3b
 )
   AND deleted_at IS NULL;

-- Bob (D1 user_id=10) is left in place as a permanent test user. Deleting him
-- via /api/admin/users/:id would create a third cross-DB orphan in
-- project_members (one each from Block 2 verification scenario 16 and Block 3).
-- The combined cleanup waits for the requireWorkspaceAdmin migration follow-up
-- (HANDOFF "Open follow-ups carried into Block 3").
```

Cookie cleanup (Jenny):

```bash
rm -f /tmp/block3-jenny-cookie.txt /tmp/block3-bob-cookie.txt
```

## Pass criteria

All 22 scenarios PASS (S16 composite, S22 by inspection). Block 3 is verified end-to-end on the preview deploy; ff-merge to `main` gates on Jenny's per-push approval per WORKFLOW.

Post-merge production smoke checks:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://elinnoagent.com/api/crypto-roundtrip
# Expected: 404 (gate fails closed; ALLOW_CRYPTO_SMOKE not set on Production)

curl -sS https://elinnoagent.com/api/db-health | python3 -m json.tool
# Expected: ok:true; Hyperdrive→Neon round-trip still healthy (Block 1 regression check)
```
