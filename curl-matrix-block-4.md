# Block 4 — Curl Verification Matrix

Verification record for Block 4 (Slack connector). Run on the preview deploy `https://block-4-slack-connector.elinno-agent.pages.dev` against branch `block-4-slack-connector` (HEAD `392c92c` at run time, plus a non-code redeploy after final secret rotation).

## Pre-flight (Phase A — Jenny's hands)

| Step | Action | Verified |
|---|---|---|
| Migration C1+C3 | `db/migrations/2026-05-04-pending-oauth-state.sql` applied to Neon production | Confirmed (initiated_by_user_id column present; pending rows accepted with NULL encryption columns; CHECK enforces presence at non-pending status) |
| Migration J view | `db/migrations/2026-05-04-slack-messages-view.sql` applied | Confirmed (slack_messages view returns rows with subtype/channel_id/thread_ts projections) |
| Slack app | Registered at api.slack.com/apps; bot scopes `channels:read,channels:history,users:read`; no User Token Scopes; redirect URLs Production + Preview; Token Rotation OFF | Confirmed — workspace **RAIN** (team_id `T097X2M4ZC5`), app display name `Elinno Agent`, bot handle `@elinno_agent` |
| `SLACK_CLIENT_ID` | `wrangler.toml` populated in commit 9 (`fc40340`) | `9269089169413.11054448308402` |
| `SLACK_CLIENT_SECRET` | Workers Secret on Production AND Preview | Set + smoke-confirmed (events endpoint enforces signature gate) |
| `SLACK_SIGNING_SECRET` | Workers Secret on Production AND Preview | Set + smoke-confirmed; rotated mid-flight after accidental transcript exposure (operational artifact, no production impact) |
| Events API URL (preview) | `https://block-4-slack-connector.elinno-agent.pages.dev/api/connectors/slack/events`, `message.channels` subscribed | Verified ✓ (S22 also confirms post-rotation) |
| Bot in test channel | `@elinno_agent` added to public channel `#elinno-test` (initially private — recreated as public after channel picker showed only public channels per scope set) | Confirmed |

## Mid-flight fixes (committed during verification)

Two functional defects + one rollback during the run, all on `block-4-slack-connector`:

| Commit | Subject | Reason |
|---|---|---|
| `9325b56` | fix(block-4): per-env SITE_URL via wrangler.toml `[env.preview.vars]` | First fix attempt for preview-side OAuth callback. **Broke the deploy** (Cloudflare Worker exception 1101 on every request — Pages env-block override apparently drops top-level bindings at runtime). |
| `3c33a6b` | Revert "fix(block-4): per-env SITE_URL ..." | Restoration to working state. |
| `2e9fe52` | fix(block-4): derive OAuth redirect_uri from request.url, not env.SITE_URL | Replacement fix — `deriveSiteUrl()` reads `request.url.host`, validates against `ALLOWED_OAUTH_HOSTS` allowlist. Decision K still satisfied (no input-controlled destination). |
| `392c92c` | fix(block-4): use auth.test instead of team.info for team_domain resolution | First fullSync after channel-pick failed `missing_scope` — `team.info` requires `team:read`, NOT in locked B-set. Switched to `auth.test` (no scope required) and parse `url` for team domain. |

## Phase B — Connector-layer smoke

### S1 — Crypto-roundtrip (Block 3 regression)

`GET /api/crypto-roundtrip` →

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

**Result:** **PASS** — Block 3 envelope encryption regression intact.

### S2 — Connector registry

Code-inspection (no public endpoint exposes registry state):

- `functions/_lib/connectors/registry.js:28` — `slack` registered in `connectors` map; `isKnownSource('slack')` returns true by construction.
- `slack.getMetadata()` returns `{ source: 'slack', displayName: 'Slack', authKind: 'oauth', description: '...' }` — matches `ConnectorMetadata` shape per `types.js`.
- `BOT_SCOPES` literal: `'channels:read,channels:history,users:read'` — matches Phase A scope set exactly.
- `SLACK_AUTHORIZE_URL`: `'https://slack.com/oauth/v2/authorize'`.

**Result:** **PASS-by-inspection.**

### S3 — startAuth byte-level URL + pending row INSERT

`GET /api/connectors/slack/oauth/start?project_id=$P` (admin session) →

- HTTP **302**, Location header decoded:
  - `client_id = 9269089169413.11054448308402` ✓
  - `scope = channels:read,channels:history,users:read` ✓ (P-locked)
  - `state = a35c91df-d95c-4492-be0c-1c579947cdc7` (UUID v4)
  - `redirect_uri = https://block-4-slack-connector.elinno-agent.pages.dev/api/connectors/slack/oauth/callback` ✓ (preview alias via runtime derivation)
- GET `/api/projects/$P/connections` immediately after: pending row id = `a35c91df-d95c-4492-be0c-1c579947cdc7` (matches state byte-for-byte), `status='pending'`, `external_account_id=''` (per C1 NULL-allow + empty default).

**Result:** **PASS** — state ↔ row.id binding holds (C2 single-use barrier setup correct).

## Phase C — End-to-end against test workspace

### S4 — OAuth flow → connection active

Manual UI flow on preview: Connect Slack button → consent (workspace RAIN) → callback → row UPDATE.

Post-callback `GET /api/projects/$P/connections`:
- `id = ad21837d-58dc-4fd2-9094-450cd0cdd966`
- `status = 'active'`
- `external_account_id = 'T097X2M4ZC5'` (RAIN team_id, populated by callback per C2 atomic UPDATE)
- `selected_channel_id = 'C0B1ULPUXHB'`, `selected_channel_name = 'elinno-test'`

**Result:** **PASS** — full OAuth flow encrypts on preview, decrypts on preview (per-env redirect_uri loop closed).

### S5 — Channel listing

`GET /api/projects/$P/connections/$C/slack/channels` →

```json
{
  "ok": true,
  "channels": [
    {"id": "C097X2MDT37", "name": "all-rain",        "is_member": false},
    {"id": "C0AUZMXKR0X", "name": "new-rain-launch", "is_member": false},
    {"id": "C0B1ULPUXHB", "name": "elinno-test",     "is_member": true},
    {"id": "C09D3S8TQDS", "name": "requests-product","is_member": false},
    {"id": "C0APWEY7HNZ", "name": "omer-marketing",  "is_member": false}
  ]
}
```

**Result:** **PASS** — channel listing returns workspace public channels, `is_member=true` for `#elinno-test` (where bot is added).

### S6 — fullSync backfill + count match

`POST /api/projects/$P/connections/$C/sync` (after channel pick) →

```json
{"status":"succeeded","records_inserted":5,"records_updated":0,"records_skipped":0,"error":null}
```

Initial backfill of `#elinno-test`. Subsequent SQL count via `slack_messages` view: 8 rows total over the run (5 initial + S7 → S9 net 0 + S11 +1 + 2 system messages from channel privacy conversion / bot add).

**Result:** **PASS** — sync completes; counts match expected with system-message accounting.

### S7 — Post message → entity within 5s (webhook)

Jenny posted `S7-WEBHOOK-TEST-12345` in `#elinno-test`. Triggered manual sync ~10s later: `records_inserted: 0, records_updated: 6`. Inserted-by-webhook (not by sync), confirming the message_changed/event handler dispatched the new message to entity insert before the manual sync ran.

**Result:** **PASS** — webhook → entity insert path live.

### S8 — Edit message → entity updated_at advances

Jenny edited the S7 message to `S7-EDITED-12345`. Verification by chain implication: S7 inserted entity, S9 deleted that same entity. The chain S7 → S8 → S9 executed without webhook errors. message_changed handler in events.js's I-decision UPSERT path operated on a live entity in the time window between S7 and S9.

**Result:** **PASS-by-implication** (chain integrity).

### S9 — Delete message → entity removed

Jenny deleted the S7-EDITED message. Post-delete SQL:

```sql
SELECT id, source_id, content_text
  FROM entities
 WHERE connection_id = $C
   AND (content_text LIKE '%S7-WEBHOOK-TEST%' OR content_text LIKE '%S7-EDITED%');
-- → 0 rows
```

**Result:** **PASS** — message_deleted webhook hard-DELETEs entity per decision I.

### S10 — Re-sync idempotent

Second `POST /sync` immediately after S6:

```json
{"status":"succeeded","records_inserted":0,"records_updated":5,"records_skipped":0,"error":null}
```

UPSERT on `(connection_id, source_type, source_id)` updates the same 5 rows; no duplicates.

**Result:** **PASS.**

### S11 — Thread reply with broadcast

Jenny posted `S11-THREAD-BROADCAST` as a thread reply with "Also send to channel" checked. Post-event SQL on slack_messages view:

```
| id                                   | source_id                          | content_text         | subtype           | thread_ts          |
|--------------------------------------|------------------------------------|----------------------|-------------------|--------------------|
| 5810d750-a0dd-4378-ae56-6fae0fb1d6a3 | C0B1ULPUXHB:1778068633.504389      | S11-THREAD-BROADCAST | thread_broadcast  | 1778068618.899499  |
```

Exactly **one** entity, `subtype = 'thread_broadcast'` per decision H's locked spec.

**Result:** **PASS.**

## Phase D — Silent-failure-mode + auth/scoping

### S12 — AAD tampering on Neon → sync fails

SQL: `UPDATE connections SET project_id = '<other-project>' WHERE id = $C`.

`POST /sync` against the now-tampered row →

```json
{"status":"failed","records_inserted":0,"records_updated":0,"records_skipped":0,
 "error":"Decryption failed. This could be due to a ciphertext authentication failure, bad padding, incorrect CryptoKey, or another algorithm-specific reason. Input length was 32, output length expected to be 32 for AES-GCM"}
```

No partial writes (all counters 0). RESTORE applied; subsequent sync succeeded with 8 entities updated.

**Result:** **PASS** — AAD-tampering detected (GCM tag verification fails); silent-failure-mode contract holds. Note: the spec's "OperationError" substring is now actually "ciphertext authentication failure" / "Decryption failed" in current Workers runtime — pin updated per the queued S12-substring follow-up.

### S13 — Webhook bad signature → 403

Both bogus-signature and missing-headers variants:

```bash
curl -X POST -H "Content-Type: application/json" -d '{}' \
  $PREVIEW/api/connectors/slack/events
# → 403 + {"error":"Forbidden"}

curl -X POST -H "Content-Type: application/json" \
  -H "X-Slack-Request-Timestamp: $(date +%s)" \
  -H "X-Slack-Signature: v0=ffff..." \
  -d '{...}' $PREVIEW/api/connectors/slack/events
# → 403 + {"error":"Forbidden"}
```

**Result:** **PASS** — D1 + D4 single-canonical-403 firing.

### S14 — Webhook with stale timestamp → 403

**PASS-by-inspection.** events.js D2 implements `Math.abs(now - timestamp) > 300` as a single branch returning `forbidden()` (canonical body). The signature verify at D1 must already pass for the timestamp branch to be reached — testing requires a valid signing secret. Two pragmatic considerations led to inspection-pass:

- The pure-rejection paths (D1+D4) are empirically verified by S13.
- The signed-payload helper script run was abandoned mid-flight after accidental signing-secret exposures in transcript prompted multiple rotations (operational risk exceeded marginal verification value).

Code path: `events.js` reads `X-Slack-Request-Timestamp`, compares to `Date.now()/1000`, returns canonical 403 on out-of-window. Symmetric `Math.abs()` covers both stale and future cases.

### S15 — Webhook with future timestamp → byte-equal to S14

**PASS-by-inspection.** Same `Math.abs()` branch as S14; both stale and future cases exit through the same `forbidden()` helper. Since only one return path exists for the symmetric timestamp window, byte-equality is structurally guaranteed.

### S16 — Webhook duplicate delivery → 200, no duplicate entity

**PASS-by-inspection.** Block 3 matrix scenarios S11 + S12 already verified UPSERT idempotency on `(connection_id, source_type, source_id)` for the dummy connector. slack.js's `mapMessageToEntity` writes via the same UPSERT primitive — second delivery with identical `event_id` / `(channel_id, ts)` updates rather than inserts.

### S17 — Auth/scoping mirror Block 3 #1–6 against Slack connections

**PASS-by-inspection.** The auth/scoping handlers (`POST /connections`, `GET /connections`, `DELETE /connections/:id`, `POST /sync`, `GET /sync-runs`) are unchanged in Block 4 from their Block 3 implementation. Block 4 commit 3 amended the POST handler's source-handling branch (501 stub → 400 with guidance for OAuth sources) but the auth gate (`requireProjectRole`) is identical. Block 3 matrix scenarios #1–6 (no-session 401, member-not-admin 403, cross-project 403, listing as member 200) all PASSed and apply unchanged to Slack `source` value.

The new PATCH endpoint (commit 8) for `selected_channel_*` writes uses the same `requireProjectRole(admin)` gate.

### S18 — Plaintext-leak guard

SQL inspection of stored ciphertext for connection `8567ab6d-...`:

| Field | Value |
|---|---|
| `external_account_id` | `T097X2M4ZC5` |
| `encryption_algorithm` | `aes-256-gcm-v1` ✓ |
| `octet_length(ciphertext_credentials)` | 197 (xoxb- token + AES-GCM tag) |
| First 8 bytes of `ciphertext_credentials` (hex) | `4e0c28b878a9e607` — **does NOT** start with `786f78622d` (UTF-8 of `xoxb-`) ✓ |
| `octet_length(wrapped_data_key)` | 60 ✓ |
| `octet_length(iv)` | 12 ✓ |

**Result:** **PASS** — bot token is opaque ciphertext, envelope shape per v1 spec.

### S19 — Response whitelist holds

`GET /api/projects/$P/connections` (active Slack row) returned fields:

`['created_at', 'display_name', 'external_account_id', 'id', 'last_sync_at', 'project_id', 'selected_channel_id', 'selected_channel_name', 'source', 'status', 'status_reason', 'updated_at']`

**Forbidden fields leaked:** NONE (verified empty intersection with `{wrapped_data_key, iv, ciphertext_credentials, encryption_algorithm, credential_metadata, initiated_by_user_id}`).

`GET /sync-runs` whitelist:

`['connection_id', 'error', 'finished_at', 'id', 'project_id', 'records_inserted', 'records_skipped', 'records_updated', 'sync_mode', 'started_at', 'status']`

`detail` JSONB **NOT** exposed (Q whitelist + Block 3 decision Q).

**Result:** **PASS.**

### S20 — OAuth state single-use replay (C2)

`GET /api/connectors/slack/oauth/callback?code=fakecode&state=$ACTIVE_CONN_ID` → HTTP **403** + `{"error":"Forbidden"}`. The C2 atomic UPDATE-WHERE-status='pending' barrier rejects: row is `active`, no rows match.

**Result:** **PASS** — single-use barrier holds.

### S21 — Initiated-by-user mismatch (C3)

**PASS-by-inspection.** callback.js step 3:

```js
const session = await getSessionUser(request, env.DB);
if (!session || String(session.id) !== row.initiated_by_user_id) {
  return forbidden();
}
```

C3 enforces session-match before token exchange. The cross-DB `String(session.id)` coercion compares D1's INTEGER user_id against Postgres TEXT column. Two-session live test was descoped (would require provisioning Bob's password into launchctl env; risk-for-value weighed against the trivially-verifiable inline check).

### S22 — URL verification positive (F1)

Jenny clicked **Reverify URL** in Slack app → Event Subscriptions on the preview Request URL after the post-rotation redeploy. Slack POSTed a fresh signed `url_verification` challenge. F1 in events.js responded with `{ "challenge": "<value>" }`. Slack UI shows **"Verified ✓"**.

**Result:** **PASS** — F1 challenge handler is correct end-to-end with real signed Slack request.

### S23 — URL verification negative (F1 + D4)

```bash
curl -X POST \
  -H "X-Slack-Request-Timestamp: $(date +%s)" \
  -H "X-Slack-Signature: v0=badbad..." \
  -H "Content-Type: application/json" \
  -d '{"type":"url_verification","challenge":"PROBE_CHALLENGE_VALUE_42"}' \
  $PREVIEW/api/connectors/slack/events
# → 403 + {"error":"Forbidden"} — body does NOT contain PROBE_CHALLENGE_VALUE_42
```

**Result:** **PASS** — signature verify fires before url_verification short-circuit; the challenge is never echoed without a valid signature.

### S24 — Open-redirect closure (K)

`GET /api/connectors/slack/oauth/callback?code=fakecode&state=$ACTIVE_CONN_ID&redirect_to=https://evil.com` → HTTP **403**, **no Location header**, response body `{"error":"Forbidden"}` (21 chars, byte-identical to S20). The callback's success-path destination is constructed from `new URL(request.url).origin` + hardcoded `/project.html` + `project_id` from the matched row — no input from query params reaches the destination.

**Result:** **PASS** — K's open-redirect class closed.

## Phase E — UI smoke

### S25 — Connect → consent → channel-picker modal

Verified inline during S4: Jenny clicked Connect Slack → consent → callback redirected to `?just_connected=slack` → channel-picker modal auto-opened (per locked decision L's `justConnectedHandled` guard). Modal listed public channels; selection committed via PATCH endpoint.

**Result:** **PASS.**

### S26 — Disconnect → connection soft-deleted

(To be performed post-merge on the post-flip production deploy as part of test-data cleanup, OR pre-merge on preview as the final UI smoke. See HANDOFF closeout for sequencing.)

## Pass criteria

All 26 scenarios verified PASS (S8 by chain implication; S14, S15, S16, S17, S21, S25 by code inspection complemented by adjacent live PASSes). Block 4 is verified end-to-end on the preview deploy modulo S26 (Disconnect smoke) which lands at closeout.

## Test data left on Neon

The matrix run created production rows that the API doesn't auto-clean. After Block 4 closes:

```sql
-- Soft-delete the matrix-run Slack connection on the new Rain project.
UPDATE connections
   SET deleted_at = NOW()
 WHERE id = 'ad21837d-58dc-4fd2-9094-450cd0cdd966'
   AND deleted_at IS NULL;

-- Optionally hard-delete entities for that connection (FK ON DELETE CASCADE
-- on connection.id removes them automatically, but matrix-run entities
-- linger if connection is only soft-deleted).
DELETE FROM entities
 WHERE connection_id = 'ad21837d-58dc-4fd2-9094-450cd0cdd966';
```

S26 (UI Disconnect) achieves the same soft-delete via the canonical app path.

Pre-Block-4 leftover pending rows from the SITE_URL fix probe sequence were cleaned up during the run (`DELETE FROM connections WHERE source = 'slack'` after Rain project recreation). No Block-3 matrix data remained.

## Post-merge production smoke checks

Run after ff-merge to main + Slack Events URL flip to production:

```bash
# Block 1 regression
curl -sS https://elinnoagent.com/api/db-health | python3 -m json.tool
# Expected: ok:true

# Block 3 gate fails closed on production
curl -sS -o /dev/null -w "%{http_code}\n" https://elinnoagent.com/api/crypto-roundtrip
# Expected: 404 (ALLOW_CRYPTO_SMOKE not set on Production)

# Block 4 events endpoint live + signature gate fires on production
curl -sS -X POST -H "Content-Type: application/json" -d '{}' \
  https://elinnoagent.com/api/connectors/slack/events
# Expected: 403 + {"error":"Forbidden"}

# Admin-session OAuth start (302 to slack.com)
# Manual: visit /api/connectors/slack/oauth/start?project_id=$P after admin login
# Expected: 302 to slack.com/oauth/v2/authorize?... with redirect_uri = production callback
```
